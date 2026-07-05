class Settings:
    def __init__(self, timeout):
        self.timeout = timeout


def load_settings(env):
    return Settings(timeout=int(env.get("TIMEOUT", "30")))
