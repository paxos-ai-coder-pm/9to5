#!/bin/bash
# Double-click in Finder to get the latest version of the Dev Studio and restart it.
# (The first time, macOS may ask you to allow it: right-click → Open.)
cd "$(dirname "$0")" && ./devstudio update
