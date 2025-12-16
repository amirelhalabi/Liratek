// eslint-disable-next-line react-refresh/only-export-components
import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface User {
    id: number;
    username: string;
    role: string;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Load user from localStorage on mount (simulating session persistence)
    // In a real app, we might check with the backend or rely on a token
    useEffect(() => {
        async function loadUser() {
            const storedUserId = localStorage.getItem('userId');
            if (storedUserId) {
                try {
                    const userData = await window.api.getCurrentUser(parseInt(storedUserId));
                    if (userData) {
                        setUser(userData);
                    } else {
                        localStorage.removeItem('userId');
                    }
                } catch (error) {
                    console.error('Failed to restore session:', error);
                    localStorage.removeItem('userId');
                }
            }
            setIsLoading(false);
        }
        loadUser();
    }, []);

    const login = async (username: string, password: string) => {
        try {
            const result = await window.api.login(username, password);
            if (result.success && result.user) {
                setUser(result.user);
                localStorage.setItem('userId', result.user.id.toString());
                try {
                    const { appEvents } = await import('../utils/appEvents');
                    appEvents.emit('openOpeningModal');
                } catch {}
                return { success: true };
            }
            return { success: false, error: result.error };
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'An unexpected error occurred' };
        }
    };

    const logout = async () => {
        if (user) {
            await window.api.logout(user.id);
        }
        setUser(null);
        localStorage.removeItem('userId');
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
