"""Enhetstest för hindertyperna i build_tiles.py (kräver inte osmium):  python3 -I -m unittest discover -s experiments/data -p test_hazard_kind.py"""
import importlib.util, os, unittest

spec = importlib.util.spec_from_file_location("build_tiles", os.path.join(os.path.dirname(__file__), "build_tiles.py"))
bt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bt)


class HazardKind(unittest.TestCase):
    def test_classes(self):
        self.assertEqual(bt.hazard_kind({"highway": "tertiary"}), "t")
        self.assertEqual(bt.hazard_kind({"highway": "secondary_link"}), "t")
        for hw in ("motorway", "trunk", "primary", "trunk_link", "primary_link", "motorway_link"):
            self.assertEqual(bt.hazard_kind({"highway": hw}), "T", hw)
        self.assertEqual(bt.hazard_kind({"railway": "rail"}), "r")
        self.assertEqual(bt.hazard_kind({"waterway": "stream"}), "w")

    def test_worst_wins_when_a_node_is_shared(self):
        self.assertEqual(bt.worst("t", "T"), "T")
        self.assertEqual(bt.worst("T", "t"), "T")
        self.assertEqual(bt.worst("w", "r"), "r")
        self.assertEqual(bt.worst("t", "w"), "w")  # vatten är allvarligare än en vanlig väg: passagen kopplas inte

    def test_delta_and_tiles_unchanged(self):
        self.assertEqual(bt.delta([5, 7, 4]), [5, 2, -3])


if __name__ == "__main__":
    unittest.main()
