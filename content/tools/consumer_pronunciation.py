#!/usr/bin/env python3
"""Prepare one static expression pronunciation for review/CI ingestion; never uploads."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from tts import DEFAULT_VOICE, inspect_mp3, sha256_text, synthesize


def quote(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--text', required=True, help='Exact accepted target expression; no private source context')
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--allow-tts', action='store_true')
    parser.add_argument('--validate', action='store_true', help='Validate an existing candidate without external calls')
    args = parser.parse_args()
    if not args.text.strip() or len(args.text) > 2000:
        parser.error('Expression must contain 1–2000 characters')
    source_digest = sha256_text(args.text)
    folder = args.output_dir.resolve()
    manifest = folder / (source_digest + '.json')
    if args.validate:
        item = json.loads(manifest.read_text())
        path = folder / (item['digest'] + '.mp3')
        digest, size, duration = inspect_mp3(path)
        if (item['sourceTextDigest'], item['digest'], item['byteSize'], item['durationMs']) != (source_digest, digest, size, duration):
            raise ValueError('Static pronunciation metadata mismatch')
        print(json.dumps({'validated': True, 'digest': digest, 'byteSize': size, 'durationMs': duration}))
        return
    if not args.allow_tts:
        parser.error('Generation is opt-in; pass --allow-tts after owner authorization')
    if manifest.exists():
        parser.error('Candidate already exists; use --validate instead of purchasing another call')
    folder.mkdir(parents=True, exist_ok=True)
    pending = folder / (source_digest + '.pending.mp3')
    result = synthesize(args.text, pending, allow_external=True)
    digest, size, duration = inspect_mp3(pending)
    if size > 2097152:
        raise ValueError('Audio exceeds consumer media limit')
    pending.rename(folder / (digest + '.mp3'))
    item = {'text': args.text, 'sourceTextDigest': source_digest, 'digest': digest, 'byteSize': size,
            'durationMs': duration, 'mimeType': 'audio/mpeg', 'producer': 'microsoft-edge-tts',
            'voice': DEFAULT_VOICE, 'rate': '+0%', 'locale': 'en-US'}
    manifest.write_text(json.dumps(item, ensure_ascii=False, indent=2) + '\n')
    (folder / (source_digest + '.sql')).write_text(
        'INSERT INTO sensa_consumer.published_media(digest,source_text_digest,mime_type,byte_size,producer) VALUES('
        + ','.join([quote(digest), quote(source_digest), quote('audio/mpeg'), str(size), quote(item['producer'])])
        + ') ON CONFLICT DO NOTHING;\n')
    print(json.dumps({'candidate': str(manifest), 'digest': digest, 'byteSize': size, 'durationMs': result.duration_ms}))


if __name__ == '__main__':
    main()
