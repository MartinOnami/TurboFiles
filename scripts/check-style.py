#!/usr/bin/env python3
"""Prose style guard for TurboFiles.

Fails if "AI slop" punctuation appears in any tracked text file, keeping the
website, app, and docs in plain ASCII. Banned: em-dashes, en-dashes, and curly
(smart) quotes. Use a hyphen, comma, colon or period instead of dashes, and
straight quotes instead of curly ones.

Run locally with `npm run check:style`; CI runs it on every push and PR.

The banned characters are built with chr() below, so this file is pure ASCII
and passes its own check.
"""
import re
import subprocess
import sys

BAD = {
    chr(0x2014): "em-dash; use a hyphen, comma, colon or period",
    chr(0x2013): "en-dash; use a hyphen",
    chr(0x2018): "left curly single quote; use a straight apostrophe",
    chr(0x2019): "right curly single quote / apostrophe; use a straight apostrophe",
    chr(0x201C): "left curly double quote; use a straight double-quote",
    chr(0x201D): "right curly double quote; use a straight double-quote",
}
# Skip lockfiles and binary assets (they may legitimately contain these bytes).
SKIP = re.compile(r"\.(lock|png|jpe?g|gif|icns|ico|svg|woff2?|ttf|webp)$|package-lock\.json|Cargo\.lock")

files = subprocess.check_output(["git", "ls-files"], text=True).splitlines()
problems = []
for f in files:
    if SKIP.search(f):
        continue
    try:
        text = open(f, encoding="utf-8").read()
    except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
        continue
    for lineno, line in enumerate(text.splitlines(), 1):
        for ch, why in BAD.items():
            if ch in line:
                problems.append(f"{f}:{lineno}: {why}")

if problems:
    print("Style check failed - disallowed punctuation found:\n")
    print("\n".join(problems))
    print("\nUse plain ASCII: no em-dashes, en-dashes, or curly quotes.")
    sys.exit(1)

print("Style check passed: no em-dashes, en-dashes, or curly quotes.")
