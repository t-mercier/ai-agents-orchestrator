//! The status badge on the app's icon: a red dot with the number of sessions waiting for the
//! user, or an orange dot with the number of busy ones. The renderer decides which
//! (renderer/lib/dock-status-model.js) and calls `set_dock_status` only when that changes.
//!
//! On macOS the badge is drawn into a copy of the app icon and set as the Dock icon. Other
//! platforms get the waiting count as the window's badge count, where the platform has one.

use tauri::{AppHandle, Webview};

/// What the badge shows. `None` from `badge_for` is the plain icon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Badge {
    Waiting(u32),
    Busy(u32),
}

/// The badge for a renderer request. An unknown kind or a zero count is the plain icon, so a
/// bad call can never leave a stale dot behind.
pub fn badge_for(kind: &str, count: u32) -> Option<Badge> {
    if count == 0 {
        return None;
    }
    match kind {
        "waiting" => Some(Badge::Waiting(count)),
        "busy" => Some(Badge::Busy(count)),
        _ => None,
    }
}

/// The text inside the dot: the count, capped at "99+".
#[cfg(any(target_os = "macos", test))]
pub fn label(count: u32) -> String {
    if count > 99 { "99+".to_string() } else { count.to_string() }
}

/// Width of the dot's pill: a circle for one digit, widened to fit the text with a margin on
/// each side for two or more.
#[cfg(any(target_os = "macos", test))]
pub fn pill_width(diameter: f64, text_width: f64) -> f64 {
    diameter.max(text_width + diameter * 0.5)
}

/// Sets the Dock badge from the renderer. Only the main window may change the icon: a call
/// from any other window (the detached session windows) is ignored. Never fails.
#[tauri::command]
pub fn set_dock_status(app: AppHandle, webview: Webview, kind: String, count: u32) {
    if webview.label() != "main" {
        return;
    }
    apply(&app, badge_for(&kind, count));
}

#[cfg(not(target_os = "macos"))]
fn apply(app: &AppHandle, badge: Option<Badge>) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let count = match badge {
            Some(Badge::Waiting(n)) => Some(i64::from(n)),
            _ => None,
        };
        // Unsupported on some platforms, and a missing badge is no reason to fail.
        let _ = w.set_badge_count(count);
    }
}

#[cfg(target_os = "macos")]
fn apply(app: &AppHandle, badge: Option<Badge>) {
    // NSApplication is main-thread only. A failed dispatch leaves the icon as it was.
    let _ = app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;

        let Some(mtm) = MainThreadMarker::new() else { return };
        let ns_app = NSApplication::sharedApplication(mtm);
        let icon = match badge {
            None => None,
            Some(b) => match macos::compose(&ns_app, b) {
                Some(img) => Some(img),
                None => return,
            },
        };
        // SAFETY: called on the main thread, the only thread AppKit allows to change the icon.
        unsafe { ns_app.setApplicationIconImage(icon.as_deref()) };
    });
}

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool};
    use objc2_app_kit::{
        NSApplication, NSBezierPath, NSColor, NSCompositingOperation, NSFont, NSFontAttributeName, NSForegroundColorAttributeName, NSImage,
        NSStringDrawing,
    };
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    use super::{label, pill_width, Badge};

    thread_local! {
        // The app's own icon, read before the first badge is drawn. Composing from the icon
        // AppKit reports afterwards would stack a badge on the badge.
        static BASE_ICON: RefCell<Option<Retained<NSImage>>> = const { RefCell::new(None) };
    }

    /// The app icon with the badge drawn on it. The drawing runs when AppKit draws the image,
    /// on the main thread, with the base icon captured here.
    pub fn compose(ns_app: &NSApplication, badge: Badge) -> Option<Retained<NSImage>> {
        let base = BASE_ICON.with(|cell| {
            let mut slot = cell.borrow_mut();
            if slot.is_none() {
                *slot = ns_app.applicationIconImage();
            }
            slot.clone()
        })?;
        let size = base.size();
        let handler = RcBlock::new(move |rect: NSRect| -> Bool {
            draw(&base, rect, badge);
            Bool::YES
        });
        Some(NSImage::imageWithSize_flipped_drawingHandler(size, false, &handler))
    }

    fn colour(badge: Badge) -> (f64, f64, f64) {
        match badge {
            // #FF3B30 and #FF9F0A.
            Badge::Waiting(_) => (1.0, 59.0 / 255.0, 48.0 / 255.0),
            Badge::Busy(_) => (1.0, 159.0 / 255.0, 10.0 / 255.0),
        }
    }

    fn count(badge: Badge) -> u32 {
        match badge {
            Badge::Waiting(n) | Badge::Busy(n) => n,
        }
    }

    fn draw(base: &NSImage, rect: NSRect, badge: Badge) {
        let (w, h) = (rect.size.width, rect.size.height);
        let full = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(w, h));
        base.drawInRect_fromRect_operation_fraction(full, NSRect::ZERO, NSCompositingOperation::SourceOver, 1.0);

        // Dimensions from the icon width: a dot 30% of it, a ring 2 px at 128 px.
        let diameter = w * 0.3;
        let ring = w * 2.0 / 128.0;
        let text = NSString::from_str(&label(count(badge)));
        let font = NSFont::boldSystemFontOfSize(diameter * 0.58);
        let white = NSColor::whiteColor();
        let attrs = attributes(&font, &white);
        // SAFETY: the attributes dictionary holds a font and a colour for the keys AppKit reads.
        let text_size = unsafe { text.sizeWithAttributes(Some(&attrs)) };
        let pill_w = pill_width(diameter, text_size.width);

        // Top-right corner, inset by the ring so the ring stays inside the icon.
        let x = w - pill_w - ring;
        let y = h - diameter - ring;
        let (r, g, b) = colour(badge);

        let dark = NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, 0.55);
        let outer = NSRect::new(
            NSPoint::new(x - ring, y - ring),
            NSSize::new(pill_w + 2.0 * ring, diameter + 2.0 * ring),
        );
        dark.set();
        NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(outer, diameter / 2.0 + ring, diameter / 2.0 + ring).fill();

        let fill = NSColor::colorWithSRGBRed_green_blue_alpha(r, g, b, 1.0);
        let inner = NSRect::new(NSPoint::new(x, y), NSSize::new(pill_w, diameter));
        fill.set();
        NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(inner, diameter / 2.0, diameter / 2.0).fill();

        let at = NSPoint::new(x + (pill_w - text_size.width) / 2.0, y + (diameter - text_size.height) / 2.0);
        // SAFETY: as for sizeWithAttributes above.
        unsafe { text.drawAtPoint_withAttributes(at, Some(&attrs)) };
    }

    fn attributes(font: &NSFont, colour: &NSColor) -> Retained<NSDictionary<NSString, AnyObject>> {
        let keys: [&NSString; 2] = unsafe { [NSFontAttributeName, NSForegroundColorAttributeName] };
        let font: &AnyObject = font.as_ref();
        let colour: &AnyObject = colour.as_ref();
        NSDictionary::from_slices(&keys, &[font, colour])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_count_or_an_unknown_kind_is_the_plain_icon() {
        assert_eq!(badge_for("waiting", 0), None);
        assert_eq!(badge_for("busy", 0), None);
        assert_eq!(badge_for("idle", 3), None);
        assert_eq!(badge_for("", 3), None);
        assert_eq!(badge_for("shell", 3), None, "only the two badge kinds are drawn");
    }

    #[test]
    fn waiting_and_busy_keep_their_count() {
        assert_eq!(badge_for("waiting", 2), Some(Badge::Waiting(2)));
        assert_eq!(badge_for("busy", 7), Some(Badge::Busy(7)));
    }

    #[test]
    fn the_label_is_the_count_capped_at_99_plus() {
        assert_eq!(label(1), "1");
        assert_eq!(label(99), "99");
        assert_eq!(label(100), "99+");
        assert_eq!(label(u32::MAX), "99+");
    }

    #[test]
    fn a_single_digit_stays_a_circle_and_two_or_more_digits_widen_the_pill() {
        assert_eq!(pill_width(40.0, 10.0), 40.0, "narrow text keeps the circle");
        assert_eq!(pill_width(40.0, 36.0), 56.0, "text plus a margin on each side");
        assert!(pill_width(40.0, 36.0) > pill_width(40.0, 10.0));
    }
}
