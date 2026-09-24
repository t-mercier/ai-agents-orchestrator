import unittest

import pr_mine


class IsMine(unittest.TestCase):
    ME = {"timotheemercier-tomtom", "t-mercier"}

    def test_a_pr_i_opened_is_mine(self):
        pr = {"author": {"login": "TimotheeMercier-tomtom"}, "reviews": []}
        self.assertTrue(pr_mine.is_mine(pr, self.ME))

    def test_a_pr_i_reviewed_is_mine(self):
        pr = {"author": {"login": "someone"}, "reviews": [{"author": {"login": "TimotheeMercier-tomtom"}}]}
        self.assertTrue(pr_mine.is_mine(pr, self.ME))

    def test_a_pr_i_neither_opened_nor_reviewed_is_not(self):
        pr = {"author": {"login": "KamilKolaczynski-TomTom"}, "reviews": [{"author": {"login": "piotrlebski-tomtom"}}]}
        self.assertFalse(pr_mine.is_mine(pr, self.ME))

    def test_a_review_request_alone_does_not_count(self):
        pr = {"author": {"login": "someone"}, "reviews": [], "reviewRequests": [{"login": "TimotheeMercier-tomtom"}]}
        self.assertFalse(pr_mine.is_mine(pr, self.ME))


class Logins(unittest.TestCase):
    def test_every_logged_in_account_is_me(self):
        status = (
            "github.com\n"
            "  ✓ Logged in to github.com account TimotheeMercier-tomtom (keyring)\n"
            "  - Active account: true\n"
            "  ✓ Logged in to github.com account t-mercier (keyring)\n"
            "  - Active account: false\n"
        )
        self.assertEqual(pr_mine.logins_from_status(status), {"timotheemercier-tomtom", "t-mercier"})


class Keep(unittest.TestCase):
    def test_the_creation_link_stays_whoever_wrote_the_pr(self):
        fetch = lambda url: {"author": {"login": "someone"}, "reviews": []}
        urls = ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"]
        kept = pr_mine.keep(urls, {"me"}, fetch, protect={"https://github.com/o/r/pull/1"})
        self.assertEqual(kept, ["https://github.com/o/r/pull/1"])

    def test_a_pr_that_cannot_be_read_is_kept_only_when_asked(self):
        fetch = lambda url: None
        urls = ["https://github.com/o/r/pull/9"]
        self.assertEqual(pr_mine.keep(urls, {"me"}, fetch), [])
        self.assertEqual(pr_mine.keep(urls, {"me"}, fetch, keep_unknown=True), urls)


if __name__ == "__main__":
    unittest.main()
