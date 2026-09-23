import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("configure", Path(__file__).parents[1] / "configure.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConfigurationTests(unittest.TestCase):
    def test_rejects_invalid_or_injected_addresses_and_pins(self):
        for address, pin in [("host.example", "test-pin-123"), ("::1", "test-pin-123"),
                             ('1.2.3.4"', "test-pin-123"), ("192.168.1.50", 'pin"\nadmin=true'),
                             ("192.168.1.50", "short")]:
            with self.subTest(address=address, pin=pin), self.assertRaises(ValueError):
                module.render(address, pin)

    def test_listener_access_does_not_expose_management_key(self):
        first = module.render("192.168.1.50", "test-pin-123")
        second = module.render("192.168.1.50", "test-pin-123")
        self.assertIn('pin = "test-pin-123"', first["janus.plugin.streaming.jcfg"])
        self.assertNotIn('admin_key = "test-pin-123"', first["janus.plugin.streaming.jcfg"])
        self.assertNotEqual(first["janus.plugin.streaming.jcfg"], second["janus.plugin.streaming.jcfg"])
        self.assertIn("admin_http = false", first["janus.transport.http.jcfg"])


if __name__ == "__main__":
    unittest.main()
