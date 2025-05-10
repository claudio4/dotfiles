function zypper --wraps='sudo zypper'

    switch $argv[1]
    
        case up
        
            sudo env ZYPP_PCK_PRELOAD=1 zypper dup
            
        case dup
        
            sudo env ZYPP_PCK_PRELOAD=1 zypper $argv
            
        case rm
        
            sudo zypper rm --clean-deps $argv[2]
            
        case ref
        
            sudo env ZYPP_CURL2=1 zypper $argv
            
        case '*'
        
            sudo zypper $argv
            
    end
    
end
