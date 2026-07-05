import os
import json

import requests
import yaml
import fastapi

from utils import load_settings


def fetch(url):
    settings = load_settings(os.environ)
    response = requests.get(url, timeout=settings.timeout)
    payload = json.loads(response.text)
    return yaml.safe_dump(payload), fastapi.__version__
