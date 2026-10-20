# A harmless window for testing computer use: a text box whose contents are written to the given file on close.
param([string]$Out)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'CBA desktop test'; $form.Width = 520; $form.Height = 320; $form.StartPosition = 'CenterScreen'
$box = New-Object Windows.Forms.TextBox
$box.Multiline = $true; $box.Dock = 'Fill'; $box.Font = New-Object Drawing.Font('Segoe UI', 14)
$form.Controls.Add($box)
$form.Add_FormClosing({ [IO.File]::WriteAllText($Out, $box.Text) })
[void]$form.ShowDialog()
