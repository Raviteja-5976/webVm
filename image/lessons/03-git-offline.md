# Lesson 3: git without the internet

The sandbox has no network, so we use a local "remote": a bare repository
sitting in a folder. Everything else works exactly like GitHub.

## A remote and a working copy

    git init --bare ~/remote.git
    git clone ~/remote.git ~/project
    cd ~/project

## Commit

    echo "# Project" > README.md
    git add README.md
    git commit -m "Add README"
    git log --oneline

## Push and pull

    git push -u origin main
    git clone ~/remote.git ~/teammate        # a second person
    cd ~/teammate && echo "hi" > hello.txt
    git add . && git commit -m "Say hi" && git push
    cd ~/project && git pull                 # get their work

## Branch and merge

    git switch -c feature
    echo "new idea" >> README.md
    git commit -am "Describe the idea"
    git switch main
    git merge feature
    git log --oneline --graph --all

## Challenge

Create a merge conflict on purpose (change the same line on two branches),
then resolve it with `nano README.md`, `git add` and `git commit`.
