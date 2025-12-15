import { useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

interface MainLayoutProps {
    children: ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
        return localStorage.getItem('sidebar_collapsed') === 'true';
    });

    const toggleSidebar = () => {
        setIsSidebarCollapsed(prev => {
            const newState = !prev;
            localStorage.setItem('sidebar_collapsed', String(newState));
            return newState;
        });
    };

    return (
        <div className="flex h-screen bg-slate-900 text-white overflow-hidden">
            <Sidebar isCollapsed={isSidebarCollapsed} toggleSidebar={toggleSidebar} />
            <div className="flex-1 flex flex-col overflow-hidden transition-all duration-300">
                <TopBar />
                <main className="flex-1 overflow-auto p-6 bg-slate-950">
                    {children}
                </main>
            </div>
        </div>
    );
}
