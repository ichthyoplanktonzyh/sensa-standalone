"""No-cost checks of provider replacement, cache identity and corruption handling."""
import hashlib
import tempfile
from pathlib import Path
from unittest.mock import patch
import spoken_resource as speech

class Fake:
    name = 'fixture'
    model = 'v1'
    calls = 0
    def voice(self, language):
        if language != 'en':
            raise ValueError('unsupported')
        return 'test-voice', 'en-US'
    def generate(self, text, voice, locale, rate, path):
        self.calls += 1
        path.write_bytes(text.encode())

def inspect(path):
    data = path.read_bytes()
    return hashlib.sha256(data).hexdigest(), len(data), 100

def rejects(call):
    try:
        call()
    except (ValueError, RuntimeError):
        return
    raise AssertionError('Expected rejection')

with tempfile.TemporaryDirectory() as directory, patch.object(speech, 'inspect_mp3', inspect):
    cache = Path(directory)
    fake = Fake()
    rejects(lambda: speech.prepare('borrow', 'en', cache, provider=fake))
    first = speech.prepare('borrow', 'en', cache, provider=fake, allow_external=True)
    assert fake.calls == 1
    assert speech.prepare('borrow', 'en', cache, provider=fake) == first
    assert fake.calls == 1
    fake.model = 'v2'
    rejects(lambda: speech.prepare('borrow', 'en', cache, provider=fake))
    rejects(lambda: speech.prepare('borrow', 'fr', cache, provider=fake))
    fake.model = 'v1'
    next(cache.glob('*.mp3')).write_bytes(b'corrupt')
    rejects(lambda: speech.prepare('borrow', 'en', cache, provider=fake))
rejects(lambda: speech.EdgeSpeechProvider().voice('fr'))
assert speech.EdgeSpeechProvider().voice('en')[1] == 'en-US'
print('PASS: speech provider substitution, explicit external-call gate, cache reuse, model isolation, corruption and unsupported language; no network.')
