"""Delivers a feedback batch to a running Claude cloud chat.

A cloud chat cannot reach this computer and takes text only, so the screenshots travel on a
private Git branch and the message is queued with `claude -p ... --cloud <session>`. The branch
is built with Git plumbing, so the checkout and anyone's uncommitted work stay untouched.

Every command runs as an argument list, never through a shell, because the message can hold
text taken from a web page.
"""
import base64
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

BRANCH_PREFIX = "annotations/"
BRANCH_DAYS = 14
GIT_NAME = "Annotate"
GIT_EMAIL = "annotate@users.noreply.github.com"
MESSAGE_LIMIT = 3500
# Vercel reads its settings from the commit it would build, so each batch opts out itself.
NO_DEPLOY = '{ "git": { "deploymentEnabled": false } }\n'


class CloudError(Exception):
    pass


def session_of(link):
    match = re.search(r"session_[A-Za-z0-9]+", link or "")
    if not match:
        raise CloudError("Paste the cloud chat's link from claude.ai/code")
    return match.group(0)


def find_cli():
    roaming = os.environ.get("APPDATA", "")
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [Path(roaming) / "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe"]
    candidates += sorted(Path(local, "Claude-Data").glob("*/claude-code/*/*/claude.exe"), reverse=True)
    on_path = shutil.which("claude.exe")
    if on_path:
        candidates.insert(0, Path(on_path))
    for path in candidates:
        if path.is_file():
            return str(path)
    raise CloudError("The claude command is not installed on this computer")


def run(args, cwd=None, data=None, env=None, timeout=60):
    done = subprocess.run(
        args, cwd=cwd, input=data, capture_output=True, env=env, timeout=timeout, check=False,
        creationflags=subprocess.CREATE_NO_WINDOW)
    if done.returncode:
        reason = done.stderr.decode(errors="replace").strip() or done.stdout.decode(errors="replace").strip()
        raise CloudError(f"{Path(args[0]).stem} failed: {reason[:300]}")
    return done.stdout.decode(errors="replace").strip()


def git(repo, *args, data=None, env=None):
    return run(["git", "-C", str(repo), *args], data=data, env=env)


def repo_name(repo):
    if not Path(repo, ".git").exists():
        raise CloudError(f"Not a Git project folder: {repo}")
    url = git(repo, "remote", "get-url", "origin")
    match = re.search(r"github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?$", url)
    return match.group(1) if match else None


def is_private(name):
    return run(["gh", "repo", "view", name, "--json", "visibility", "-q", ".visibility"]) == "PRIVATE"


def write_tree(repo, folder):
    """Stores a folder as a Git tree. Input is bytes, so Windows cannot add \\r to the names."""
    lines = []
    for path in sorted(folder.iterdir()):
        if path.is_dir():
            lines.append(f"040000 tree {write_tree(repo, path)}\t{path.name}\n")
        else:
            blob = git(repo, "hash-object", "-w", "--no-filters", str(path))
            lines.append(f"100644 blob {blob}\t{path.name}\n")
    return git(repo, "mktree", data="".join(lines).encode())


def push_folder(repo, branch, folder, title):
    Path(folder, "vercel.json").write_text(NO_DEPLOY, encoding="utf-8", newline="\n")
    tree = write_tree(repo, folder)
    identity = {
        "GIT_AUTHOR_NAME": GIT_NAME, "GIT_AUTHOR_EMAIL": GIT_EMAIL,
        "GIT_COMMITTER_NAME": GIT_NAME, "GIT_COMMITTER_EMAIL": GIT_EMAIL,
    }
    commit = git(repo, "commit-tree", tree, "-m", title, env={**os.environ, **identity})
    git(repo, "push", "--quiet", "origin", f"{commit}:refs/heads/{branch}")


def prune_branches(repo):
    """Cloud chats cannot delete branches, so old batches are removed from here."""
    cutoff = time.strftime("%Y-%m-%d", time.localtime(time.time() - BRANCH_DAYS * 86400))
    listed = git(repo, "ls-remote", "--heads", "origin", f"{BRANCH_PREFIX}*")
    old = []
    for line in listed.splitlines():
        ref = line.split("\t")[-1].removeprefix("refs/heads/")
        stamp = ref.removeprefix(BRANCH_PREFIX)[:10]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", stamp) and stamp < cutoff:
            old.append(ref)
    if old:
        git(repo, "push", "--quiet", "origin", "--delete", *old)


def compose(summary, branch, number, title):
    lines = [f"Feedback from the annotation tool on {title}."]
    if branch:
        where = f"/tmp/annotate-{number}"
        lines += [
            f"Full notes and screenshots are on branch {branch}. Fetch them without changing the repo:",
            f"mkdir -p {where} && git fetch origin {branch} && git archive FETCH_HEAD | tar -x -C {where}",
            f"Then read {where}/notes.md and open each image in {where}/crops with your Read tool.",
            "Keep these files out of the repository and do not commit them.",
        ]
    else:
        lines.append("Screenshots are not included, because the project has no private GitHub repository.")
    text = "\n".join(lines + ["", summary])
    return text[:MESSAGE_LIMIT].rstrip()


def deliver(link, repo, folder, summary, slug, number, title):
    """Sends one saved batch. Returns where it went, or raises CloudError."""
    session = session_of(link)
    repo = (repo or "").strip()
    name = repo_name(repo) if repo else None
    branch = None
    if name and is_private(name):
        day = time.strftime("%Y-%m-%d")
        branch = f"{BRANCH_PREFIX}{day}-{slug[:40].rstrip('-')}-{number:04}"
        push_folder(repo, branch, folder, f"Annotation batch {number}: {title}")
    text = compose(summary, branch, number, title)
    run([find_cli(), "-p", text, "--cloud", session], cwd=repo or None, timeout=90)
    if branch:
        try:
            prune_branches(repo)
        except CloudError:
            pass  # the batch is delivered; old branches can go next time
    return {"session": session, "branch": branch, "images": bool(branch)}


def decode_image(data):
    """Accepts a data URL or plain base64 and returns the bytes."""
    try:
        return base64.b64decode(data.split(",", 1)[-1], validate=True)
    except (ValueError, AttributeError) as error:
        raise CloudError("That image could not be read") from error
