# Lesson 2: Pipes, redirection and grep

Small tools, chained together, do big jobs.

## Redirection

    echo "hello" > notes.txt     # write (replaces the file)
    echo "world" >> notes.txt    # append
    cat notes.txt
    wc -l < notes.txt            # read a file as input

## Pipes

The `|` sends one command's output into the next command's input.

    ls -la /usr/bin | wc -l               # how many programs?
    ps aux | grep bash                    # find a process
    history | tail -5                     # your last five commands

## grep

    grep hello notes.txt                  # lines containing "hello"
    grep -i HELLO notes.txt               # ignore case
    grep -rn "PS1" ~/.bashrc              # recursive, with line numbers
    grep -v '^#' /etc/login.defs | grep -v '^$' | head    # skip comments and blanks

## Counting things

    printf 'b\na\nc\na\nb\na\n' > letters.txt
    sort letters.txt | uniq -c | sort -rn

## Challenge

Print the five most common words in this lesson file:

    tr -cs 'A-Za-z' '\n' < ~/lessons/02-pipes-and-grep.md | tr 'A-Z' 'a-z' | sort | uniq -c | sort -rn | head -5
