$ErrorActionPreference = "Stop"

Set-Location "C:\cpu6502\CPU6502_ts"

$env:CPU6502_WS_HOST = "127.0.0.1"
$env:CPU6502_WS_PORT = "8765"

python .\python\ws_server.py
