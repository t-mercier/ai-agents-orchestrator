use std::process::Command;

fn main() {
  tauri_build::build();

  // The date of the bundled skills and hooks, for skills::skills_status()'s "would this
  // overwrite go backward?" check. Reads the last commit that touched skills/ or hooks/ (not HEAD)
  // so an unrelated later commit — a renderer change, a doc fix — doesn't make the app
  // think its bundle is newer than it really is. A missing `.git` (a tarball build) or a
  // failed lookup falls back to "0", which skills::bundle_epoch() reads as "unknown" and
  // the UI treats as neutral rather than as a false claim in either direction.
  let epoch = Command::new("git")
    .args(["log", "-1", "--format=%ct", "--", "skills", "hooks"])
    .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/.."))
    .output()
    .ok()
    .filter(|o| o.status.success())
    .and_then(|o| String::from_utf8(o.stdout).ok())
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| "0".to_string());
  println!("cargo:rustc-env=AO_SKILLS_BUNDLE_EPOCH={epoch}");

  // The checkout this binary was built from, so a build from a clone can notice later
  // that `git pull` moved skills/ or hooks/ past what is installed — WITHOUT anyone having
  // run scripts/install.sh first. That script records the same path in the skills manifest
  // and still wins when it has run; this is the value for everyone who never ran it.
  //
  // A release .dmg carries its CI path (/Users/runner/work/...), which does not exist on
  // anybody's machine: skills::installed_from_checkout canonicalizes and requires
  // scripts/install.sh to be there, so the baked path reads as "no checkout" and the app
  // stays quiet. Same outcome once a clone is moved or deleted.
  let checkout = std::fs::canonicalize(concat!(env!("CARGO_MANIFEST_DIR"), "/.."))
    .map(|p| p.to_string_lossy().into_owned())
    .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/..").to_string());
  println!("cargo:rustc-env=AO_SKILLS_CHECKOUT={checkout}");

  // Re-run when skills/ changes so a local `tauri dev` picks up the new date, not just
  // whatever was true the first time cargo built this crate.
  println!("cargo:rerun-if-changed=../skills");
  println!("cargo:rerun-if-changed=../hooks");
  println!("cargo:rerun-if-changed=../agents");
}
