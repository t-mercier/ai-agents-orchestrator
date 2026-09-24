"""Unit tests for aoconfig.py: a category name shared by several spaces resolves per space.

Run: python3 -m unittest discover -s skills/lib -p 'test_*.py'
"""
import importlib.util
import os
import unittest

_spec = importlib.util.spec_from_file_location(
    'aoconfig', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'aoconfig.py'))
aoconfig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(aoconfig)

# FEAT exists under both spaces; each space has its own vault.
CFG = {
    'roots': [
        {'name': 'Work', 'path': '/W', 'vaultPath': '/WORKVAULT'},
        {'name': 'Perso', 'path': '/P', 'vaultPath': '/PERSOVAULT'},
    ],
    'categories': [
        {'name': 'FEAT', 'root': 'Work'},
        {'name': 'FEAT', 'root': 'Perso'},
        {'name': 'BUG', 'root': 'Work'},
    ],
    'knowledge': {'enabled': True},
}


class VaultAndScopeTakeARoot(unittest.TestCase):
    def test_vault_follows_the_given_root(self):
        self.assertEqual(aoconfig.vault_for(CFG, 'FEAT', 'Perso'), '/PERSOVAULT')
        self.assertEqual(aoconfig.vault_for(CFG, 'FEAT', 'Work'), '/WORKVAULT')

    def test_vault_without_root_keeps_first_match(self):
        self.assertEqual(aoconfig.vault_for(CFG, 'FEAT'), '/WORKVAULT')

    def test_scope_follows_the_given_root(self):
        self.assertEqual(aoconfig.scope_of(CFG, 'FEAT', 'Perso'), 'personal')
        self.assertEqual(aoconfig.scope_of(CFG, 'FEAT', 'Work'), 'work')

    def test_v1_shim_uses_the_given_root(self):
        cfg = {'workRoot': '/W', 'personalRoot': '/P',
               'categories': [{'name': 'FEAT', 'scope': 'work'},
                              {'name': 'FEAT', 'scope': 'personal'}],
               'knowledge': {'enabled': True,
                             'workVaultPath': '/WV', 'personalVaultPath': '/PV'}}
        self.assertEqual(aoconfig.vault_for(cfg, 'FEAT', 'Perso'), '/PV')


class RootOf(unittest.TestCase):
    def test_notes_path_maps_to_its_space(self):
        self.assertEqual(aoconfig.root_of_path(CFG, '/P/FEAT/x/notes.md'), 'Perso')
        self.assertEqual(aoconfig.root_of_path(CFG, '/W/FEAT/x/notes.md'), 'Work')

    def test_nested_roots_pick_the_longest_prefix(self):
        cfg = {'roots': [{'name': 'Perso', 'path': '/home/u'},
                         {'name': 'Work', 'path': '/home/u/work'}]}
        self.assertEqual(aoconfig.root_of_path(cfg, '/home/u/work/FEAT/x/notes.md'), 'Work')
        self.assertEqual(aoconfig.root_of_path(cfg, '/home/u/FEAT/x/notes.md'), 'Perso')

    def test_prefix_must_end_on_a_separator(self):
        self.assertEqual(aoconfig.root_of_path(CFG, '/Wx/FEAT/x/notes.md'), '')


class Bases(unittest.TestCase):
    def test_every_root_category_pair_is_listed(self):
        self.assertEqual(aoconfig.all_bases(CFG), ['/W/FEAT', '/P/FEAT', '/W/BUG'])


if __name__ == '__main__':
    unittest.main()
