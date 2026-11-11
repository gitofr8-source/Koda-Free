using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;

namespace KodaLauncher
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                Directory.SetCurrentDirectory(baseDir);

                // 1. Ensure Koda local server is running on port 3000
                if (!IsPortOpen("127.0.0.1", 3000))
                {
                    string nodeExe = FindNodeExecutable();
                    string serverScript = Path.Combine(baseDir, "server.js");

                    if (File.Exists(serverScript) && !string.IsNullOrEmpty(nodeExe))
                    {
                        ProcessStartInfo psi = new ProcessStartInfo
                        {
                            FileName = nodeExe,
                            Arguments = "\"" + serverScript + "\"",
                            WorkingDirectory = baseDir,
                            UseShellExecute = true,
                            WindowStyle = ProcessWindowStyle.Hidden
                        };
                        Process.Start(psi);

                        // Wait up to 3 seconds for server to bind port 3000
                        for (int i = 0; i < 15; i++)
                        {
                            Thread.Sleep(200);
                            if (IsPortOpen("127.0.0.1", 3000)) break;
                        }
                    }
                }

                // 2. Launch in dedicated standalone Desktop App Window
                string url = "http://localhost:3000";
                string edge1 = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
                string edge2 = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
                string chrome1 = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
                string chrome2 = @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe";

                string browser = null;
                bool isEdge = false;

                if (File.Exists(edge1)) { browser = edge1; isEdge = true; }
                else if (File.Exists(edge2)) { browser = edge2; isEdge = true; }
                else if (File.Exists(chrome1)) { browser = chrome1; }
                else if (File.Exists(chrome2)) { browser = chrome2; }

                if (!string.IsNullOrEmpty(browser))
                {
                    string args = "--app=\"" + url + "\" " + (isEdge ? "--app-id=\"koda-frontier-ai\" " : "") + "--window-size=1360,860";
                    ProcessStartInfo appPsi = new ProcessStartInfo
                    {
                        FileName = browser,
                        Arguments = args,
                        UseShellExecute = true,
                        CreateNoWindow = true
                    };
                    Process.Start(appPsi);
                }
                else
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = url,
                        UseShellExecute = true
                    });
                }
            }
            catch
            {
                // Never show any unhandled crash or console window to user
            }
        }

        static bool IsPortOpen(string host, int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult result = client.BeginConnect(host, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(400);
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        static string FindNodeExecutable()
        {
            string localNode = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node.exe");
            if (File.Exists(localNode)) return localNode;

            string progFilesNode = @"C:\Program Files\nodejs\node.exe";
            if (File.Exists(progFilesNode)) return progFilesNode;

            string progFiles86Node = @"C:\Program Files (x86)\nodejs\node.exe";
            if (File.Exists(progFiles86Node)) return progFiles86Node;

            return "node.exe";
        }
    }
}
