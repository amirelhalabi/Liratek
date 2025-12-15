import { useState } from 'react';
import { LogOut, Bell, Search, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export default function TopBar() {
    const { user, logout } = useAuth();
    const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

    return (
        <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-6 relative z-50">
            {/* Search Bar (Global) */}
            <div className="relative w-96">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-500" />
                </div>
                <input
                    type="text"
                    className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent text-white placeholder-slate-500 text-sm"
                    placeholder="Global Search (Coming Soon)..."
                    disabled
                />
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-4">
                <div className="relative">
                    <button 
                        onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                        className={`p-2 transition-colors relative ${isNotificationsOpen ? 'text-white bg-slate-700 rounded-lg' : 'text-slate-400 hover:text-white'}`}
                    >
                        <Bell size={20} />
                        <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>
                    </button>

                    {/* Notification Panel */}
                    {isNotificationsOpen && (
                        <div className="absolute right-0 top-full mt-2 w-80 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                            <div className="p-3 border-b border-slate-700 flex items-center justify-between bg-slate-900/50">
                                <h3 className="font-bold text-white text-sm">Notifications</h3>
                                <button onClick={() => setIsNotificationsOpen(false)} className="text-slate-400 hover:text-white">
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="max-h-64 overflow-y-auto p-4 text-center">
                                <div className="p-4 rounded-full bg-slate-700/50 inline-flex mb-3">
                                    <Bell size={24} className="text-slate-500" />
                                </div>
                                <p className="text-slate-400 text-sm">No new notifications</p>
                                <p className="text-slate-600 text-xs mt-1">We'll let you know when something important happens.</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="h-8 w-px bg-slate-700"></div>

                <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium text-white">{user?.username || 'Admin'}</p>
                        <p className="text-xs text-slate-400 capitalize">{user?.role || 'Administrator'}</p>
                    </div>

                    <button
                        onClick={logout}
                        className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                        title="Logout"
                    >
                        <LogOut size={20} />
                    </button>
                </div>
            </div>
        </header>
    );
}
