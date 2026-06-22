# JARVIS

A multi-agent AI system. Jarvis coordinates specialist agents to help with local development work.

## Workspace Chat

Start Jarvis from the project folder you want it to use:

```bash
cd path/to/project
jarvis
```

Inside the chat:

```txt
/code <request>       Run the coding-agent workflow in the current folder
/run <command>        Run a command in the current folder
/git push [args]      Push the current Git branch
/exit                 Save and close the session
```

You can also run one coding request without entering chat:

```bash
jarvis code "build a frontend page with a backend API"
```
