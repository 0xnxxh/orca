export const WINDOWS_REMOTE_CLI_LAUNCHER_SOURCE = String.raw`using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class OrcaRemoteCliLauncher
{
    private static int Main(string[] args)
    {
        try
        {
            string nodePath = RequireEnvironmentVariable("ORCA_RELAY_NODE_PATH");
            string relayDirectory = RequireEnvironmentVariable("ORCA_RELAY_DIR");
            string socketPath = RequireEnvironmentVariable("ORCA_RELAY_SOCKET_PATH");
            string credentialFile = Environment.GetEnvironmentVariable("ORCA_RELAY_CREDENTIAL_FILE");
            if (String.IsNullOrEmpty(credentialFile))
            {
                credentialFile = socketPath + ".credential";
            }
            string relayPath = Path.Combine(relayDirectory, "relay.js");

            if (!File.Exists(nodePath))
            {
                Console.Error.WriteLine("Orca SSH CLI bridge cannot find Node.js at \"{0}\"", nodePath);
                return 1;
            }
            if (!File.Exists(relayPath))
            {
                Console.Error.WriteLine("Orca SSH CLI bridge cannot find the relay at \"{0}\"", relayPath);
                return 1;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = BuildArguments(relayPath, socketPath, credentialFile, args),
                UseShellExecute = false
            };

            using (Process child = Process.Start(startInfo))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Unable to start the Orca SSH CLI bridge: {0}", error.Message);
            return 1;
        }
    }

    private static string RequireEnvironmentVariable(string name)
    {
        string value = Environment.GetEnvironmentVariable(name);
        if (String.IsNullOrEmpty(value))
        {
            throw new InvalidOperationException(name + " is not set.");
        }
        return value;
    }

    private static string BuildArguments(string relayPath, string socketPath, string credentialFile, string[] args)
    {
        StringBuilder commandLine = new StringBuilder();
        AppendArgument(commandLine, relayPath);
        AppendArgument(commandLine, "--sock-path");
        AppendArgument(commandLine, socketPath);
        AppendArgument(commandLine, "--credential-file");
        AppendArgument(commandLine, credentialFile);
        AppendArgument(commandLine, "--orca-cli");
        foreach (string arg in args)
        {
            AppendArgument(commandLine, arg);
        }
        return commandLine.ToString();
    }

    private static void AppendArgument(StringBuilder commandLine, string value)
    {
        if (commandLine.Length > 0)
        {
            commandLine.Append(' ');
        }
        commandLine.Append(QuoteArgument(value));
    }

    private static string QuoteArgument(string value)
    {
        bool requiresQuotes = value.Length == 0;
        for (int index = 0; index < value.Length && !requiresQuotes; index += 1)
        {
            requiresQuotes = value[index] == '"' || Char.IsWhiteSpace(value[index]);
        }
        if (!requiresQuotes)
        {
            return value;
        }

        StringBuilder quoted = new StringBuilder("\"");
        int backslashCount = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashCount += 1;
                continue;
            }
            if (character == '"')
            {
                quoted.Append('\\', backslashCount * 2 + 1);
                quoted.Append('"');
            }
            else
            {
                quoted.Append('\\', backslashCount);
                quoted.Append(character);
            }
            backslashCount = 0;
        }

        quoted.Append('\\', backslashCount * 2);
        quoted.Append('"');
        return quoted.ToString();
    }
}
`
