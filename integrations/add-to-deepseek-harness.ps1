# 把 Cindy 桌宠的 MCP 服务加进 DeepSeek Harness（DSH）。运行：在 PowerShell 里执行本脚本。
# 它会：1) 备份 ~/.dsh/cordis.patch.yml  2) 在末尾追加 cindy-pet 一段（已存在则不重复追加）。
# 撤销：把备份文件 cordis.patch.yml.bak-cindy-pet 复制回 cordis.patch.yml 即可。
$ErrorActionPreference = 'Stop'
$patch = Join-Path $env:USERPROFILE '.dsh\cordis.patch.yml'
$node  = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\Lib\site-packages\nodejs_wheel\node.exe'
$mcp   = Join-Path $env:LOCALAPPDATA 'Programs\cindy-desktop-pet\resources\integrations\deskpet-mcp.cjs'
if (-not (Test-Path $patch)) { throw "找不到 $patch" }
if (-not (Test-Path $node))  { Write-Warning "没找到 $node ，请把下面的 command 改成你的 node.exe 路径" }
if (-not (Test-Path $mcp))   { Write-Warning "没找到 $mcp （请先安装桌宠）" }
$text = [IO.File]::ReadAllText($patch)
if ($text -match 'mcp-cindy-pet') { Write-Host '已经添加过 cindy-pet，无需重复。'; exit 0 }
Copy-Item $patch "$patch.bak-cindy-pet" -Force
$nl = if ($text -match "`r`n") { "`r`n" } else { "`n" }
if (-not $text.EndsWith($nl)) { $text += $nl }
$add = @(
  '    - id: mcp-cindy-pet',
  '      name: "@deepseek-ai/dsh-mcp-client"',
  '      config:',
  '        serverName: cindy-pet',
  '        transport: stdio',
  "        command: $node",
  '        args:',
  "          - $mcp",
  '        env:',
  '          DESKPET_URL: http://127.0.0.1:47831',
  '        toolCallTimeoutMs: 30000',
  '        failOnStartupError: false'
) -join $nl
[IO.File]::WriteAllText($patch, $text + $add + $nl, (New-Object Text.UTF8Encoding($false)))
Write-Host "已添加。备份在 $patch.bak-cindy-pet 。请重启 DeepSeek Harness，并保持桌宠运行。"
