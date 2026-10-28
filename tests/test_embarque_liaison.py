"""Chemin « robot réel » de esp32_bridge sans matériel : faux pyserial (un FirmwareSimule en temps réel derrière l'interface de pyserial).

Contrairement au mode `mock=True` (horloge virtuelle), ici les ports sont « ouverts », la lecture est non bloquante, les accusés et
les fins de mouvement arrivent en temps réel, et le fil d'entretien envoie les PING du chien de garde.
"""
from __future__ import annotations

import time
import types
from dataclasses import replace

import pytest

import esp32_bridge
from esp32_bridge import PARAMS, DualESP32Orchestrator, FirmwareSimule, HorlogeReelle, SerieSimulee

PARAMS_RAPIDES = replace(PARAMS, mock_delai_tirette_s=0.2, poll_s=0.002, periode_ping_s=0.05, watchdog_ms=300, timeout_s=0.5)


class SerialFictif:
    """Même interface que serial.Serial (timeout=0 : lecture non bloquante)."""
    ouverts: dict = {}

    def __init__(self, port, baudrate=0, timeout=0, write_timeout=None):
        role = "NAV" if "nav" in port else "ACT"
        self.fw = FirmwareSimule(role, HorlogeReelle(), PARAMS_RAPIDES)
        self._s = SerieSimulee(self.fw)
        self._s.virtuelle = False                               # temps réel : le Pi attend vraiment les réponses
        self.baudrate = baudrate
        SerialFictif.ouverts[role] = self

    is_open = property(lambda self: self._s.is_open)
    in_waiting = property(lambda self: self._s.in_waiting)

    def write(self, data):
        return self._s.write(data)

    def read(self, n=1):
        return self._s.read(n)

    def flush(self):
        pass

    def reset_input_buffer(self):
        pass

    reset_output_buffer = reset_input_buffer

    def close(self):
        self._s.close()


def test_chemin_reel_handshake_depart_par_tirette_execution_et_chien_de_garde(monkeypatch):
    monkeypatch.setattr(esp32_bridge, "serial", types.SimpleNamespace(Serial=SerialFictif))
    orch = DualESP32Orchestrator("/dev/nav_fictif", "/dev/act_fictif", baudrate=921600, mock=False, params=PARAMS_RAPIDES)
    try:
        assert orch.initialize(pose=(0.0, 0.0, 0.0), vitesses={"lineaire_mm_s": 1000, "rotation_deg_s": 360})
        assert SerialFictif.ouverts["NAV"].baudrate == 921600
        t0 = time.monotonic()
        assert orch.attendre_depart(timeout_s=3.0)                                   # tirette en place puis retirée au bout de 0,2 s
        assert 0.15 < time.monotonic() - t0 < 1.5
        plan = {"brique": {"a": "seDeplacer"}, "dt": 0.3, "events": [{"kind": "VAC", "face": "A", "rows": [1, 0, 0], "t0": 0.0, "t1": 0.1}],
                "moves": [{"g": "NAV", "pts": [{"t": 0.0, "v": [0, 0, 0]}, {"t": 0.3, "v": [300, 0, 0]}]},
                          {"g": "GRIP_A", "pts": [{"t": 0.0, "v": [165, 0]}, {"t": 0.3, "v": [200, 0]}]}]}
        debut = time.monotonic()
        rap = orch.executer(plan)
        assert rap.ok, rap.erreur
        assert 0.25 < time.monotonic() - debut < 1.5                                 # durées réelles : 300 mm à 1000 mm/s, vérin en 300 ms
        assert orch.lire_pose() == pytest.approx((300.0, 0.0, 0.0))
        assert orch.lire_actionneurs().tenue["A"] == (1, 0, 0)
        # le fil d'entretien envoie des PING : aucune sécurité du chien de garde (300 ms) malgré 0,6 s de silence du programme principal
        time.sleep(0.6)
        assert not orch.nav.erreurs and not orch.act.erreurs
        orch.arreter_tout()
    finally:
        orch.close()
    assert not orch.nav.liaison.is_open


def test_ports_inverses_refuses_par_hello(monkeypatch):
    class Inverse(SerialFictif):
        def __init__(self, port, **kw):
            super().__init__("act" if "nav" in port else "nav", **kw)
    monkeypatch.setattr(esp32_bridge, "serial", types.SimpleNamespace(Serial=Inverse))
    orch = DualESP32Orchestrator("/dev/nav_fictif", "/dev/act_fictif", mock=False, params=replace(PARAMS_RAPIDES, essais_hello=1, timeout_s=0.1))
    assert orch.initialize() is False
    orch.close()
