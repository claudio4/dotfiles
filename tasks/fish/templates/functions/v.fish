{%! if ($.nvim) { %}
function v --wraps=nvim
    nvim $argv;
end
{%! } else { %}
function v --wraps=vim
     vim $argv;
end
{%! } %}
