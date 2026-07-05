def process_queue(queue):
    try:
        queue.drain()
    except Exception:
        pass


def poll_status(client):
    try:
        return client.status()
    except:
        print("status check failed")


def load_config(path):
    try:
        with open(path) as handle:
            return handle.read()
    except FileNotFoundError as error:
        raise RuntimeError(f"config missing: {path}") from error
