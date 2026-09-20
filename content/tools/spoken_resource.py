"""Saved speech provider used by Book preparation and on-demand learning.

No external calls without --allow-tts. Cache identity includes every synthesis
parameter; metadata and bytes are verified again on every cache hit.
"""
from __future__ import annotations
import argparse
import base64
import fcntl
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path
from typing import Protocol
from tts import synthesize, inspect_mp3


class SpeechProvider(Protocol):
    name: str
    model: str
    def voice(self, language: str) -> tuple[str, str]: ...
    def generate(self, text: str, voice: str, locale: str, rate: str, path: Path) -> None: ...


class EdgeSpeechProvider:
    name = 'microsoft-edge-tts'
    model = 'neural-v1'
    voices = {
        'en': ('en-US-JennyNeural', 'en-US'),
        'en-US': ('en-US-JennyNeural', 'en-US'),
        'en-GB': ('en-GB-SoniaNeural', 'en-GB'),
        'zh': ('zh-CN-XiaoxiaoNeural', 'zh-CN'),
        'zh-CN': ('zh-CN-XiaoxiaoNeural', 'zh-CN'),
        'zh-Hans': ('zh-CN-XiaoxiaoNeural', 'zh-CN'),
        'ja': ('ja-JP-NanamiNeural', 'ja-JP'),
        'ja-JP': ('ja-JP-NanamiNeural', 'ja-JP'),
    }
    def voice(self, language):
        if language not in self.voices:
            raise ValueError('speech_language_unavailable')
        return self.voices[language]
    def generate(self, text, voice, locale, rate, path):
        synthesize(text, path, voice=voice, rate=rate, accent_locale=locale, allow_external=True)


def prepare(text: str, language: str, cache: Path, *, allow_external=False,
            provider: SpeechProvider | None = None) -> dict:
    if not isinstance(text, str) or not text.strip() or len(text) > 500 or text != text.strip():
        raise ValueError('invalid_speech_text')
    if not isinstance(language, str) or not re.fullmatch(r'[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*', language):
        raise ValueError('invalid_speech_language')
    provider = provider or EdgeSpeechProvider()
    voice, locale = provider.voice(language)
    identity = dict(provider=provider.name, model=provider.model, text=text,
                    languageTag=language, voice=voice, locale=locale, rate='+0%', format='mp3')
    key = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    cache.mkdir(parents=True, exist_ok=True)
    with (cache / (key + '.lock')).open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        audio, metadata = cache / (key + '.mp3'), cache / (key + '.json')
        if not (audio.exists() and metadata.exists()):
            if not allow_external:
                raise RuntimeError('speech_not_cached: explicitly enable TTS generation')
            with tempfile.TemporaryDirectory(dir=cache) as temp:
                output = Path(temp) / 'speech.mp3'
                provider.generate(text, voice, locale, identity['rate'], output)
                digest, size, duration = inspect_mp3(output)
                if size > 2_000_000:
                    raise ValueError('speech_too_large')
                record = dict(identity, sha256=digest, sizeBytes=size, durationMs=duration)
                staged = Path(temp) / 'speech.json'
                staged.write_text(json.dumps(record, ensure_ascii=False))
                output.replace(audio)
                staged.replace(metadata)
        record = json.loads(metadata.read_text())
        digest, size, duration = inspect_mp3(audio)
        if any(record.get(k) != v for k, v in identity.items()) or (digest, size, duration) != (record['sha256'], record['sizeBytes'], record['durationMs']):
            raise ValueError('speech_cache_corrupt')
        return dict(surface=text, languageTag=language,
                    audioUrl='data:audio/mpeg;base64,' + base64.b64encode(audio.read_bytes()).decode(),
                    phoneticNotation=None, accentLabel=locale, method='tts',
                    source=json.dumps(record, ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-tts', action='store_true')
    parser.add_argument('--cache', type=Path, default=Path('content/data/media/audio/speech-cache'))
    args = parser.parse_args()
    try:
        request = json.loads(sys.stdin.read(4096))
        print(json.dumps(prepare(request['surface'], request['languageTag'], args.cache,
                                 allow_external=args.allow_tts), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
