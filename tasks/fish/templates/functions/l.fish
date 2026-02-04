{%! if ($.eza) { %}
function l --wraps=eza
    eza -lah $argv;
end
{%! } else { %}
function l --wraps=ls
     ls -lah $argv;
end
{%! } %}
