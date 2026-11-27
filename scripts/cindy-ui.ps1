# 桌宠 ⇄ Cindy 界面桥（仅 Windows）：读取 Cindy 窗口里正在等你处理的“提问卡 / 命令确认卡”，并在桌宠上点选后代为点击对应按钮。
# 只读界面文字、只点击名称匹配的按钮；常驻进程，从 stdin 读一行 JSON 指令，向 stdout 写一行 JSON 结果。
[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$W = [System.Windows.Automation.TreeWalker]::RawViewWalker
Add-Type -Namespace Pet -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);'
function CindyWin {
  # 缓存窗口句柄，避免每次都 Get-Process（跨进程枚举有开销）；句柄失效或进程变了才重找
  if ($script:cindyPid -and (Get-Process -Id $script:cindyPid -ErrorAction SilentlyContinue) -and $script:cindyHwnd -ne 0 -and $script:cindyHwnd -eq (Get-Process -Id $script:cindyPid).MainWindowHandle) {
    return $A::FromHandle($script:cindyHwnd)
  }
  $p = Get-Process -Name Cindy -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { $script:cindyPid = $null; $script:cindyHwnd = 0; return $null }
  $script:cindyPid = $p.Id; $script:cindyHwnd = $p.MainWindowHandle
  return $A::FromHandle($script:cindyHwnd)
}
# 用 CacheRequest 一次性把整棵子树的 Name + ControlType 缓存下来（单次跨进程批量取回），
# 相比逐节点读 Current.*（每属性一次跨进程往返，实测整窗 2.5s+），缓存方式整窗只需约 0.15s。
# 注意三个 PowerShell 均表（均已踩过）：
# 1) CacheRequest 默认用 ContentView 过滤器，会丢节点，必须改成 RawViewCondition；
# 2) 缓存后不能用 $e.CachedName（PowerShell 取值 quirk，恒为空），要用 GetCachedPropertyValue；
# 3) GetUpdatedCache 自带激活，不需要也不应该手动 Activate/Pop。
$CacheReq = New-Object System.Windows.Automation.CacheRequest
$CacheReq.TreeScope = [System.Windows.Automation.TreeScope]::Subtree
$CacheReq.TreeFilter = [System.Windows.Automation.Automation]::RawViewCondition
$CacheReq.Add([System.Windows.Automation.AutomationElement]::NameProperty)
$CacheReq.Add([System.Windows.Automation.AutomationElement]::ControlTypeProperty)
$NP = [System.Windows.Automation.AutomationElement]::NameProperty
function FlatCached($root, $limit) {
  $list = New-Object System.Collections.ArrayList
  function Rec($e, $d) {
    if ($d -gt 45 -or $list.Count -ge $limit) { return }
    foreach ($c in $e.CachedChildren) {
      $t = $c.GetCachedPropertyValue([System.Windows.Automation.AutomationElement]::ControlTypeProperty).ProgrammaticName -replace 'ControlType\.', ''
      $n = $c.GetCachedPropertyValue($NP)
      [void]$list.Add([pscustomobject]@{ el = $c; d = $d; t = $t; n = ($n -replace "[\r\n]+", ' ') })
      Rec $c ($d + 1)
      if ($list.Count -ge $limit) { return }
    }
  }
  Rec $root 0
  return ,$list
}
function Flat($root, $limit) {
  # 保留实时读取版本：click 时用于在缓存树里找不到按钮时的兜底（缓存可能过期）
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
  $cached = $win.GetUpdatedCache($CacheReq)
  $nodes = FlatCached $cached 3000; $items = @()
  # ① 提问卡：以“收起问题卡片”为锚
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $b = $nodes[$i]
    if ($b.t -eq 'Button' -and $b.n -eq '收起问题卡片') {
      $header = ''; if ($i -gt 0 -and $nodes[$i - 1].t -eq 'Text') { $header = $nodes[$i - 1].n }
      $q = ''; $opts = @(); $j = $i + 1
      while ($j -lt $nodes.Count -and $nodes[$j].d -ge $b.d) {
        $x = $nodes[$j]
        if ($x.d -eq $b.d -and $x.t -eq 'Text' -and $opts.Count -eq 0) { $q = $q + $x.n }
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
  # ② 命令 / 权限确认卡：以“拒绝”+“允许…”按钮为锚。缓存树里直接取祖先链上的文本，不再向上逐层实时 Flat。
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $d = $nodes[$i]
    if ($d.t -eq 'Button' -and $d.n -match '^拒绝') {
      $allow = $null; for ($k = $i + 1; $k -lt [Math]::Min($nodes.Count, $i + 14); $k++) { if ($nodes[$k].t -eq 'Button' -and $nodes[$k].n -match '^允许') { $allow = $nodes[$k]; break } }
      if (-not $allow) { continue }
      # 从锚点向上收集同层及上层的文本（缓存树按 d 深度排列，往前找最近的上层文本即可）
      $texts = @(); $prev = ''
      for ($k = $i; $k -ge [Math]::Max(0, $i - 120); $k--) {
        $x = $nodes[$k]
        if ($x.t -eq 'Text' -and $x.n -and $x.n -ne $prev -and $x.n -notmatch '^(拒绝|允许一次|允许|Esc|Enter)$') { $texts = @($x.n) + $texts; $prev = $x.n }
        if ($texts.Count -ge 6) { break }
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
    if ($cmd.cmd -eq 'scan') { $r = Scan; Out @{ id = $cmd.id; ok = $true; cindy = $r.cindy; items = @($r.items | Where-Object { $_ }) } }
    elseif ($cmd.cmd -eq 'focus') {
      $p = Get-Process -Name Cindy -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if ($p) { $h = $p.MainWindowHandle; if ([Pet.Win]::IsIconic($h)) { [void][Pet.Win]::ShowWindowAsync($h, 9) }; [void][Pet.Win]::SetForegroundWindow($h) }
      Out @{ id = $cmd.id; ok = [bool]$p } }
    elseif ($cmd.cmd -eq 'click') {
      # 先在缓存的扫描结果里找按钮；缓存元素仍带实时引用，可直接 Invoke
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
