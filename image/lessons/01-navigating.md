# Lesson 1: Finding your way around

Everything in Linux lives in one tree that starts at `/`.
Your home directory is `/home/user`, written `~` for short.

## Try it

    pwd                 # where am I?
    ls                  # what is here?
    ls -la              # everything, with details (and hidden dotfiles)
    cd lessons          # go into a directory
    cd ..               # go up one level
    cd                  # go home from anywhere
    tree -L 2 ~         # the shape of your home directory

## Make things

    mkdir -p ~/projects/demo
    touch ~/projects/demo/notes.txt
    ls -R ~/projects

## Read things

    cat ~/lessons/01-navigating.md
    less /etc/os-release        # q to quit
    man ls                      # the manual; / searches, q quits

## Challenge

Create `~/projects/readme.txt`, then find it again with:

    find ~ -name 'readme.txt'
