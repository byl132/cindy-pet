# 桌宠 ⇄ Cindy 界面桥（仅 Windows）：读取 Cindy 窗口里正在等你处理的“提问卡 / 命令确认卡”，并在桌宠上点选后代为点击对应按钮。
# 只读界面文字、只点击名称匹配的按钮；常驻进程，从 stdin 读一行 JSON 指令，向 stdout 写一行 JSON 结果。
[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$W = [System.Windows.Automation.TreeWalker]::RawViewWalker
Add-Type -Namespace Pet -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);'
function CindyWin {
  $p = Get-Process -Name Cindy -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { return $null }
  return $A::FromHandle($p.MainWindowHandle)
}
function Flat($root, $limit) {
  $list = New-Object System.Collections.ArrayList
  function Rec($e, $d) {
    if ($d -gt 45 -or $list.Count -ge $limit) { return }
    $c = $W.GetFirstChild($e)
    while ($c -ne $null -and $list.Count -lt $limit) {
      $t = $c.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
      $n = $c.Current.Name
      [void]$list.Add([pscustomobject]@{ el = $c; d = $d; t = $t; n = ($n -replace "[\r\n]+", ' ') })
      Rec $c ($d + 1); $c = $W.GetNextSibling($c)
    }
  }
  Rec $root 0
  return ,$list
}
function Scan {
  $win = CindyWin; if (-not $win) { return @{ items = @(); cindy = $false } }
  $nodes = Flat $win 3000; $items = @()
  # ① 提问卡：以“收起问题卡片”为锚
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $b = $nodes[$i]
    if ($b.t -eq 'Button' -and $b.n -eq '收起问题卡片') {
      $header = ''; if ($i -gt 0 -and $nodes[$i - 1].t -eq 'Text') { $header = $nodes[$i - 1].n }
      $q = ''; $opts = @(); $j = $i + 1
      while ($j -lt $nodes.Count -and $nodes[$j].d -ge $b.d) {
        $x = $nodes[$j]
        if ($x.d -eq $b.d -and $x.t -eq 'Text' -and -not $q) { $q = $x.n }
        elseif ($x.d -eq $b.d -and $x.t -eq 'Button') {
          if ($x.n -match '^(输入其他回答|开始语音输入|跳过)') { if ($x.n -like '跳过*') { break } else { $j++; continue } }
          $texts = @(); $k = $j + 1
          while ($k -lt $nodes.Count -and $nodes[$k].d -gt $b.d) { if ($nodes[$k].t -eq 'Text') { $texts += $nodes[$k].n }; $k++ }
          $label = if ($texts.Count) { $texts[0] } else { $x.n }
          $desc = if ($texts.Count -ge 3) { $texts[1] } else { '' }
          $opts += @{ label = $label; description = $desc }
          $j = $k; continue
        }
        $j++
      }
      if ($q -and $opts.Count) { $items += @{ kind = 'question'; header = $header; question = $q; options = $opts; sig = "q|$q|" + (($opts | ForEach-Object { $_.label }) -join ',') } }
    }
  }
  # ② 命令 / 权限确认卡：以“拒绝”+“允许…”按钮为锚，向上找包含标题和内容的容器
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $d = $nodes[$i]
    if ($d.t -eq 'Button' -and $d.n -match '^拒绝') {
      $allow = $null; for ($k = $i + 1; $k -lt [Math]::Min($nodes.Count, $i + 14); $k++) { if ($nodes[$k].t -eq 'Button' -and $nodes[$k].n -match '^允许') { $allow = $nodes[$k]; break } }
      if (-not $allow) { continue }
      $cur = $W.GetParent($d.el); $texts = @()
      for ($up = 0; $up -lt 8 -and $cur -ne $null; $up++) {
        $sub = Flat $cur 400; $texts = @(); $prev = ''
        foreach ($s in $sub) { if ($s.t -eq 'Text' -and $s.n -and $s.n -ne $prev -and $s.n -notmatch '^(拒绝|允许一次|允许|Esc|Enter)$') { $texts += $s.n; $prev = $s.n } }
        if ($texts.Count -ge 3) { break }
        $cur = $W.GetParent($cur)
      }
      if ($texts.Count -ge 2) {
        $items += @{ kind = 'permission'; title = $texts[0]; body = (($texts | Select-Object -Skip 1) -join "`n"); allowLabel = $allow.n; sig = "p|" + ($texts -join '|') }
      }
    }
  }
  return @{ items = $items; cindy = $true; nodes = $nodes }
}
function Out($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Depth 8 -Compress)); [Console]::Out.Flush() }
while (($line = [Console]::In.ReadLine()) -ne $null) {
  try {
    $cmd = $line | ConvertFrom-Json
    if ($cmd.cmd -eq 'scan') { $r = Scan; Out @{ id = $cmd.id; ok = $true; cindy = $r.cindy; items = @($r.items) } }
    elseif ($cmd.cmd -eq 'focus') {
      $p = Get-Process -Name Cindy -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if ($p) { $h = $p.MainWindowHandle; if ([Pet.Win]::IsIconic($h)) { [void][Pet.Win]::ShowWindowAsync($h, 9) }; [void][Pet.Win]::SetForegroundWindow($h) }
      Out @{ id = $cmd.id; ok = [bool]$p } }
    elseif ($cmd.cmd -eq 'click') {
      $r = Scan; $item = @($r.items) | Where-Object { $_.sig -eq $cmd.sig } | Select-Object -First 1
      if (-not $item) { Out @{ id = $cmd.id; ok = $false; error = 'changed' }; continue }
      $nodes = $r.nodes; $target = $null
      foreach ($n in $nodes) {
        if ($n.t -ne 'Button') { continue }
        if ($cmd.target -eq 'allow' -and $n.n -match '^允许一次') { $target = $n; break }
        if ($cmd.target -eq 'deny' -and $n.n -match '^拒绝') { $target = $n; break }
        if ($cmd.target -eq 'option' -and $n.n.StartsWith([string]$cmd.label)) { $target = $n; break }
        if ($cmd.target -eq 'submit' -and $n.n -match '^(提交|确认|下一步|发送)$') { $target = $n; break }
      }
      if (-not $target) { Out @{ id = $cmd.id; ok = $false; error = 'nobutton' }; continue }
      $pat = $null
      if ($target.el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $pat.Invoke(); Out @{ id = $cmd.id; ok = $true } }
      else { Out @{ id = $cmd.id; ok = $false; error = 'noinvoke' } }
    } else { Out @{ id = $cmd.id; ok = $false; error = 'unknown' } }
  } catch { Out @{ id = 0; ok = $false; error = [string]$_.Exception.Message } }
}
