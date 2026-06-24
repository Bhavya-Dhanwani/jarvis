# JARVIS

A multi-agent AI system. Jarvis coordinates specialist agents to help with local development work.

## Workspace Chat

Start Jarvis from the project folder you want it to use:

```bash
cd path/to/project
jarvis
```

Describe coding work normally and Jarvis will use the model to decide when the coding-agent workflow is needed:

```txt
Fix the API route and add a regression test
```

Explicit commands remain available:

```txt
/commands             Show all commands available in the chat
/code <request>       Force the coding-agent workflow in the current folder
/run <command>        Run a command in the current folder
/git push [args]      Push the current Git branch
/exit                 Save and close the session
```

You can also run one coding request without entering chat:

```bash
jarvis code "build a frontend page with a backend API"
```

Use `jarvis commands` to print the same command list without opening a session.
