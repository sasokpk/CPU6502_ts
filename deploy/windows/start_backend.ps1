$ErrorActionPreference = "Stop"

Set-Location "C:\cpu6502\CPU6502_ts"

$env:DJANGO_DEBUG = "0"
$env:DJANGO_ALLOWED_HOSTS = "127.0.0.1,localhost"

python .\python\manage.py runserver 127.0.0.1:8000
