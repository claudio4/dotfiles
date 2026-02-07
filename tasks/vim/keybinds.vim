" Set leader key
let mapleader = " "

" Write to system clipboard
vmap <C-c> y:Oscyank<cr>
xmap <F7> y:Oscyank<cr>

" Move selected lines up/down (like Alt-Up/Down)
vnoremap J :m '>+1<CR>gv=gv
vnoremap K :m '<-2<CR>gv=gv

" Paste without overwriting clipboard
xnoremap <leader>p "_dP
nnoremap <leader>d "_d
vnoremap <leader>d "_d

" Toggle line numbers
nnoremap <leader>ul :set number!<CR>:set relativenumber&<CR>
nnoremap <leader>uL :set relativenumber!<CR>
