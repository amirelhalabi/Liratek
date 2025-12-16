import { useState, useEffect, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import NotificationCenter from '../NotificationCenter'; // Import NotificationCenter
import { appEvents } from '../../utils/appEvents';
import Closing from '../../pages/Closing';
import Opening from '../../pages/Opening';
import { useAuth } from '../../contexts/AuthContext';

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

    const [isClosingModalOpen, setIsClosingModalOpen] = useState(false);
    const [isOpeningModalOpen, setIsOpeningModalOpen] = useState(false);
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    // Expose user id for downstream calls (Closing)
    (window as any).currentUserId = user?.id;

    // Listen to app-wide events so modals work from anywhere
    useEffect(() => {
        const offClosing = appEvents.on('openClosingModal', () => setIsClosingModalOpen(true));
        const offOpening = appEvents.on('openOpeningModal', () => setIsOpeningModalOpen(true));
        return () => {
            offClosing();
            offOpening();
        };
    }, []);

    return (
        <div className="flex h-screen bg-slate-900 text-white overflow-hidden">
            <Sidebar isCollapsed={isSidebarCollapsed} toggleSidebar={toggleSidebar} />
            <div className="flex-1 flex flex-col overflow-hidden transition-all duration-300">
                <TopBar />
                <main className="flex-1 overflow-auto p-6 bg-slate-950">
                    {children}
                </main>
            </div>
            <NotificationCenter /> {/* Render NotificationCenter here */}
            {isAdmin && isClosingModalOpen && (
                <Closing isOpen={isClosingModalOpen} onClose={() => setIsClosingModalOpen(false)} />
            )}
            {isAdmin && isOpeningModalOpen && (
                <Opening isOpen={isOpeningModalOpen} onClose={() => setIsOpeningModalOpen(false)} />
            )}
        </div>
    );
}
