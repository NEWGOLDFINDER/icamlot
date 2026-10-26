import subprocess
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKER = ROOT / "engine" / "env_worker.js"

class EnvWorkerProc:
    def __init__(self, config: dict, worker_id: int):
        self.worker_id = worker_id
        self.proc = subprocess.Popen(
            ["node", str(WORKER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        # Initialize
        hello = self.call({"cmd": "ping"})
        if hello.get("error"):
            raise RuntimeError(hello["error"])
        created = self.call({"cmd": "create", "config": config})
        if created.get("error"):
            raise RuntimeError(created["error"])

        self.n_in = created.get("nInputs", 46)
        self.n_out = created.get("nOutputs", 106)
        self.done = True

    def call(self, msg: dict) -> dict:
        if self.proc.poll() is not None:
            err = self.proc.stderr.read() if self.proc.stderr else ""
            raise RuntimeError(f"Worker {self.worker_id} crashed. " + err[:400])
        self.proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            err = self.proc.stderr.read() if self.proc.stderr else ""
            raise RuntimeError(f"Worker {self.worker_id} mute. " + err[:400])
        return json.loads(line)

    def close(self):
        try:
            self.call({"cmd": "close"})
        except Exception:
            pass
        try:
            self.proc.terminate()
        except Exception:
            pass

class EnvWorkerPool:
    def __init__(self, n_workers: int, config: dict):
        self.n_workers = n_workers
        self.workers = []
        for i in range(n_workers):
            self.workers.append(EnvWorkerProc(config, i))

    def call_all(self, msgs):
        """Synchronous parallel call (using simple loop or threads for stdout reading)"""
        # Writing to all
        for i, w in enumerate(self.workers):
            if msgs[i] is not None and w.proc.poll() is None:
                w.proc.stdin.write(json.dumps(msgs[i], ensure_ascii=False) + "\n")
                w.proc.stdin.flush()

        # Reading from all
        results = [None] * self.n_workers
        for i, w in enumerate(self.workers):
            if msgs[i] is not None and w.proc.poll() is None:
                line = w.proc.stdout.readline()
                if line:
                    results[i] = json.loads(line)
                else:
                    results[i] = {"error": "Worker mute"}
        return results

    def close(self):
        for w in self.workers:
            w.close()
