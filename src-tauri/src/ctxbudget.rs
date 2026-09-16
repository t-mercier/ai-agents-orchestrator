//! What the setup costs before the first word is typed: the text Claude Code loads into
//! every session — the global CLAUDE.md, every installed skill's description, the memory
//! index — plus the MCP servers whose tool schemas ride along (not measurable from here).
//! Measured, never trimmed: which skill to drop is the user's call. Doctor says the bill.

#[derive(Clone, Debug, Default)]
pub struct ContextBudget {
    pub found: bool,
    pub claude_md_kb: f64,
    pub skill_count: usize,
    pub skill_desc_kb: f64,
    pub memory_index_kb: f64,
    pub mcp_servers: usize,
    /// (skill, KB of its description) — the ones that weigh most on every session.
    pub heaviest: Vec<(String, f64)>,
}

impl ContextBudget {
    pub fn always_loaded_kb(&self) -> f64 {
        self.claude_md_kb + self.skill_desc_kb + self.memory_index_kb
    }
}

/// ~4 bytes per token for English/markdown prose — a working figure, not a tokenizer.
pub fn estimate_tokens(kb: f64) -> usize {
    (kb * 1024.0 / 4.0).round() as usize
}

/// Bytes of the frontmatter `description:` (folded or inline) — the part loaded at start.
/// Falls back to the whole frontmatter when there is no description key.
pub fn description_bytes(md: &str) -> usize {
    let mut lines = md.lines();
    if lines.next().map(str::trim) != Some("---") {
        return 0;
    }
    let mut fm = Vec::new();
    for l in lines {
        if l.trim() == "---" {
            break;
        }
        fm.push(l);
    }
    let mut out = 0usize;
    let mut in_desc = false;
    for l in &fm {
        let top_level_key = !l.starts_with(' ') && !l.starts_with('\t') && l.contains(':');
        if l.trim_start().starts_with("description:") {
            in_desc = true;
            out += l.trim_start_matches("description:").trim().len();
            continue;
        }
        if in_desc {
            if top_level_key {
                in_desc = false;
            } else {
                out += l.trim().len() + 1;
            }
        }
    }
    if out == 0 {
        fm.iter().map(|l| l.len() + 1).sum()
    } else {
        out
    }
}

fn kb(p: &std::path::Path) -> f64 {
    std::fs::metadata(p).map(|m| m.len() as f64 / 1024.0).unwrap_or(0.0)
}

pub fn gather() -> ContextBudget {
    let home = crate::config::home();
    let claude = home.join(".claude");
    let mut b = ContextBudget { claude_md_kb: kb(&claude.join("CLAUDE.md")), ..Default::default() };
    b.found = b.claude_md_kb > 0.0 || claude.join("skills").is_dir();
    let mut descs: Vec<(String, f64)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(claude.join("skills")) {
        for e in rd.flatten() {
            let md = e.path().join("SKILL.md");
            let Ok(text) = std::fs::read_to_string(&md) else { continue };
            let k = description_bytes(&text) as f64 / 1024.0;
            descs.push((e.file_name().to_string_lossy().to_string(), k));
        }
    }
    b.skill_count = descs.len();
    b.skill_desc_kb = descs.iter().map(|(_, k)| k).sum();
    descs.sort_by(|a, c| c.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    b.heaviest = descs.into_iter().take(3).collect();
    // One memory index is loaded per session (the cwd's project); report the largest.
    if let Ok(rd) = std::fs::read_dir(claude.join("projects")) {
        b.memory_index_kb = rd
            .flatten()
            .map(|e| kb(&e.path().join("memory").join("MEMORY.md")))
            .fold(0.0, f64::max);
    }
    if let Ok(t) = std::fs::read_to_string(home.join(".claude.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
            b.mcp_servers = v.get("mcpServers").and_then(|m| m.as_object()).map(|m| m.len()).unwrap_or(0);
        }
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_description_is_measured_inline_or_folded_and_nothing_else_counts() {
        let inline = "---\nname: x\ndescription: One line here.\nallowed-tools: Bash\n---\n# body that is long".repeat(1);
        assert_eq!(description_bytes(&inline), "One line here.".len());
        let folded = "---\nname: x\ndescription: >-\n  first part\n  second part\nallowed-tools: Bash\n---\n";
        let n = description_bytes(folded);
        assert!(n >= "first part".len() + "second part".len(), "{n}");
        assert!(n < 40, "the allowed-tools line must not be counted: {n}");
    }

    #[test]
    fn a_file_without_frontmatter_costs_nothing_at_start() {
        assert_eq!(description_bytes("# just a title\nbody"), 0);
    }

    #[test]
    fn tokens_follow_the_four_bytes_rule() {
        assert_eq!(estimate_tokens(4.0), 1024);
        assert_eq!(estimate_tokens(0.0), 0);
    }

    #[test]
    fn always_loaded_sums_the_three_texts_and_not_the_servers() {
        let b = ContextBudget { claude_md_kb: 11.0, skill_desc_kb: 21.0, memory_index_kb: 2.0, mcp_servers: 9, ..Default::default() };
        assert!((b.always_loaded_kb() - 34.0).abs() < 1e-9);
    }
}
