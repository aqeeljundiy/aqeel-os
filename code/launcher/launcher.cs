// code by aqeel.exe: starts the local server when it is not already running, then opens the app in its own native
// window. The window has no Windows caption: the app's top bar is the title bar (drag to move, double-click to
// maximise) and draws its own minimise / maximise / close buttons, like Claude's desktop app. The page runs in
// WebView2 (the Edge engine built into Windows 11). Without WebView2 it falls back to a Chrome or Edge app window.
// Build: scripts\build-exe.ps1 (needs launcher\bin\*.dll from Microsoft's WebView2 SDK next to the build).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

static class Launcher {
  const string Port = "4321";
  const string Url = "http://127.0.0.1:" + Port + "/";
  const string Title = "code by aqeel";
  static string root = AppDomain.CurrentDomain.BaseDirectory;
  static string bin = Path.Combine(root, @"launcher\bin");

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool SetDllDirectory(string path);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);

  [STAThread]
  static void Main() {
    bool first;
    var only = new Mutex(true, "code-by-aqeel-window", out first);
    if (!first) { Focus(); return; }  // already open: bring it forward instead of a second window
    try {
      if (!Up() && !StartServer()) return;
      if (!OpenNative()) OpenBrowserWindow();
    } catch (Exception e) { MessageBox.Show(e.Message, Title); }
    GC.KeepAlive(only);
  }

  static bool StartServer() {
    string node = FindOnPath("node.exe");
    if (node == null) { MessageBox.Show("Node.js is not installed. Get it from https://nodejs.org and try again.", Title); return false; }
    Directory.CreateDirectory(Path.Combine(root, "data"));
    // cmd keeps the server's output in data\server.log; the server outlives this launcher
    var start = new ProcessStartInfo("cmd.exe", "/c \"\"" + node + "\" server.mjs > data\\server.log 2>&1\"") {
      WorkingDirectory = root, CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden };
    start.EnvironmentVariables["HUB_PORT"] = Port;
    Process.Start(start);
    for (int i = 0; i < 60 && !Up(); i++) Thread.Sleep(250);
    if (Up()) return true;
    MessageBox.Show("The server did not start. See data\\server.log.", Title); return false;
  }

  static bool Up() {
    try {
      var request = (HttpWebRequest)WebRequest.Create(Url + "manifest.webmanifest");
      request.Timeout = 1500;
      using (request.GetResponse()) return true;
    } catch { return false; }
  }

  // The WebView2 assemblies live in launcher\bin; WebView2Loader.dll is found through the DLL directory.
  static bool OpenNative() {
    if (!File.Exists(Path.Combine(bin, "Microsoft.Web.WebView2.WinForms.dll"))) return false;
    SetDllDirectory(bin);
    AppDomain.CurrentDomain.AssemblyResolve += (s, e) => {
      string file = Path.Combine(bin, new AssemblyName(e.Name).Name + ".dll");
      return File.Exists(file) ? Assembly.LoadFrom(file) : null;
    };
    try { return RunWindow(); } catch (Exception e) { Debug.WriteLine(e); return false; }
  }

  // kept separate so the WebView2 assemblies load only after AssemblyResolve is in place
  [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
  static bool RunWindow() {
    Application.EnableVisualStyles();
    try { SetProcessDpiAwarenessContext((IntPtr)(-4)); } catch { }  // sharp text on scaled displays (per-monitor v2)
    var window = new AppWindow();
    if (!window.Ready()) return false;
    Application.Run(window);
    return true;
  }

  static void Focus() {
    foreach (var p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(Application.ExecutablePath)))
      if (p.MainWindowHandle != IntPtr.Zero) { ShowWindow(p.MainWindowHandle, 9); SetForegroundWindow(p.MainWindowHandle); }
  }

  static void OpenBrowserWindow() {
    string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
    string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
    string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    string[] browsers = {
      Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"), Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
      Path.Combine(local, @"Google\Chrome\Application\chrome.exe"), Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
      Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe") };
    foreach (string exe in browsers)
      if (File.Exists(exe)) { Process.Start(exe, "--app=" + Url); return; }
    Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
  }

  static string FindOnPath(string name) {
    foreach (string dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) {
      try { string file = Path.Combine(dir.Trim().Trim('"'), name); if (File.Exists(file)) return file; } catch { }
    }
    return null;
  }

  internal static string Root { get { return root; } }
  internal const string AppUrl = Url;
  internal const string AppTitle = Title;
}

// The app window: a normal resizable window whose caption is removed, so the page fills it to the top edge.
// Windows still draws the shadow and rounded corners, and side/bottom edges resize as usual.
class AppWindow : Form {
  Microsoft.Web.WebView2.WinForms.WebView2 web;

  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attribute, ref int value, int size);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  const int WM_NCCALCSIZE = 0x83;

  public AppWindow() {
    Text = Launcher.AppTitle;
    try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
    StartPosition = FormStartPosition.CenterScreen;
    var area = Screen.PrimaryScreen.WorkingArea;
    Size = new Size(Math.Min(1440, area.Width - 80), Math.Min(920, area.Height - 60));
    MinimumSize = new Size(420, 520);
    BackColor = Color.White;
    web = new Microsoft.Web.WebView2.WinForms.WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White };
    Controls.Add(web);
    Load += async (s, e) => {
      var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, Path.Combine(Launcher.Root, @"data\window"));
      await web.EnsureCoreWebView2Async(env);
      var core = web.CoreWebView2;
      core.Settings.IsNonClientRegionSupportEnabled = true;  // the page's "app-region: drag" areas move the window
      core.Settings.AreDevToolsEnabled = true;
      // links to other sites open in your normal browser
      core.NewWindowRequested += (o, a) => {
        a.Handled = true;
        if (a.Uri.StartsWith(Launcher.AppUrl)) core.Navigate(a.Uri); else Process.Start(new ProcessStartInfo(a.Uri) { UseShellExecute = true });
      };
      core.DocumentTitleChanged += (o, a) => Text = core.DocumentTitle;
      core.WebMessageReceived += (o, a) => Command(a.TryGetWebMessageAsString());
      core.Navigate(Launcher.AppUrl);
    };
    Resize += (s, e) => Tell();
  }

  public bool Ready() {
    try { return Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString() != null; } catch { return false; }
  }

  // messages from the page's window buttons and theme
  void Command(string message) {
    if (message == "min") WindowState = FormWindowState.Minimized;
    else if (message == "max") WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
    else if (message == "close") Close();
    else if (message == "ready") Tell();
    else if (message == "dark" || message == "light") {
      var color = message == "dark" ? Color.FromArgb(22, 27, 36) : Color.White;
      BackColor = color; web.DefaultBackgroundColor = color;
      int dark = message == "dark" ? 1 : 0; DwmSetWindowAttribute(Handle, 20, ref dark, 4);  // dark window border and shadow
    }
  }

  // the page shows maximise or restore
  void Tell() {
    if (web != null && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString(WindowState == FormWindowState.Maximized ? "maximized" : "normal");
  }

  protected override void WndProc(ref Message m) {
    if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero) {
      // keep the standard frame on the sides and bottom (resizing, snap) but give the caption area to the page
      var rect = (RECT)Marshal.PtrToStructure(m.LParam, typeof(RECT));
      int top = rect.Top;
      base.WndProc(ref m);
      rect = (RECT)Marshal.PtrToStructure(m.LParam, typeof(RECT));
      rect.Top = top + (WindowState == FormWindowState.Maximized ? GetSystemMetrics(33) + GetSystemMetrics(92) : 0);  // SM_CYFRAME + SM_CXPADDEDBORDER
      Marshal.StructureToPtr(rect, m.LParam, false);
      m.Result = IntPtr.Zero;
      return;
    }
    base.WndProc(ref m);
  }
}
