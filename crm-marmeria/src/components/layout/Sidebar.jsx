import { X } from 'lucide-react';

const Sidebar = ({
  isSidebarOpen,
  navItems = [],
  currentPage,
  handleNavigation,
  currentUser,
  appId,
  onClose,
}) => (
  <>
    {/* Overlay per schermi piccoli */}
    {isSidebarOpen && (
      <div
        className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      ></div>
    )}

    <aside
      className={`fixed inset-y-0 left-0 z-40 flex flex-col w-64 bg-light-primary text-white dark:bg-dark-primary dark:text-dark-text transform transition-transform duration-300 ease-in-out ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="p-4 border-b border-light-accent dark:border-dark-accent flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">CRM Marmeria</h1>
        <button
          type="button"
          onClick={onClose}
          className="lg:hidden p-2 -mr-2 rounded-md hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
          aria-label="Chiudi menu navigazione"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleNavigation(item.id)}
            className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors
              ${
                currentPage === item.id
                  ? 'bg-light-secondary text-light-primary dark:bg-dark-secondary dark:text-white shadow-md'
                  : 'hover:bg-light-accent/20 dark:hover:bg-dark-accent/20'
              }`}
          >
            {item.icon && <item.icon className="w-5 h-5" />}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-light-accent dark:border-dark-accent">
        {currentUser && (
          <div className="text-xs">
            <p>User ID: {currentUser.id}</p>
            <p>App ID: {appId}</p>
          </div>
        )}
      </div>
    </aside>
  </>
);

export default Sidebar;
