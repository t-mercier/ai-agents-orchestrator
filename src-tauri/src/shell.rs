//! The shell the app runs its commands in: the user's own ($SHELL), or, when that is
//! unset, the first of zsh, bash and sh this machine has. zsh is not installed
//! everywhere; a Linux machine often has only bash.

pub(crate) fn user_shell() -> String {
    std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(fallback_shell)
}

pub(crate) fn fallback_shell() -> String {
    first_existing(&["/bin/zsh", "/bin/bash", "/bin/sh"], |p| std::path::Path::new(p).exists())
}

fn first_existing(candidates: &[&str], exists: impl Fn(&str) -> bool) -> String {
    candidates.iter().find(|p| exists(p)).unwrap_or(&"/bin/sh").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_no_shell_set_the_first_installed_one_is_used() {
        assert_eq!(first_existing(&["/bin/zsh", "/bin/bash", "/bin/sh"], |p| p != "/bin/zsh"), "/bin/bash");
        assert_eq!(first_existing(&["/bin/zsh", "/bin/bash"], |_| false), "/bin/sh");
    }
}
