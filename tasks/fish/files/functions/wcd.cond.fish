function wcd --wraps=cd --description 'cd but for Windows directories'
     cd (wslpath $argv); 
end
