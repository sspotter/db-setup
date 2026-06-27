document.addEventListener('DOMContentLoaded', () => {
    const usersTbody = document.getElementById('users-tbody');
    const loadingSpinner = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const searchInput = document.getElementById('search-users');

    // Modals
    const addUserBtn = document.getElementById('add-user-btn');
    const addUserModal = document.getElementById('add-user-modal');
    const addUserForm = document.getElementById('add-user-form');
    const closeBtns = document.querySelectorAll('.close-modal-btn');
    const formError = document.getElementById('form-error');

    const deleteModal = document.getElementById('delete-modal');
    const deleteUserEmail = document.getElementById('delete-user-email');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

    const logoutModal = document.getElementById('logout-modal');
    const logoutUserEmail = document.getElementById('logout-user-email');
    const confirmLogoutBtn = document.getElementById('confirm-logout-btn');

    const toast = document.getElementById('toast');

    let allUsers = [];
    let userToDelete = null;
    let userToEdit = null;
    let userToLogout = null;

    // Authentication Elements
    const loginOverlay = document.getElementById('login-overlay');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const adminContainer = document.querySelector('.admin-container');

    // Initial Auth Check
    checkAuth();

    function checkAuth() {
        const password = sessionStorage.getItem('adminPassword');
        if (password) {
            loginOverlay.classList.add('hidden');
            adminContainer.classList.remove('blurred');
            fetchUsers();
        } else {
            loginOverlay.classList.remove('hidden');
            adminContainer.classList.add('blurred');
        }
    }

    function getHeaders() {
        return {
            'Content-Type': 'application/json',
            'x-admin-password': sessionStorage.getItem('adminPassword')
        };
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('admin-password').value;
        const submitBtn = loginForm.querySelector('.submit-btn');

        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Verifying...';
            loginError.classList.add('hidden');

            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });

            if (!res.ok) throw new Error('Incorrect password');

            sessionStorage.setItem('adminPassword', pwd);
            checkAuth();
        } catch (err) {
            loginError.textContent = err.message;
            loginError.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
        }
    });

    // Event Listeners
    addUserBtn.addEventListener('click', () => {
        userToEdit = null;
        addUserModal.querySelector('h3').textContent = 'Add New User';
        addUserForm.querySelector('.submit-btn').textContent = 'Create User';
        document.getElementById('password').required = true;
        addUserForm.reset();
        openModal(addUserModal);
    });
    closeBtns.forEach(btn => btn.addEventListener('click', closeAllModals));
    
    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeAllModals();
        }
    });

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => u.email.toLowerCase().includes(term));
        renderUsers(filtered);
    });

    addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const plan = document.getElementById('plan').value;
        const status = document.getElementById('status').value;
        const maxDevices = parseInt(document.getElementById('max-devices').value, 10);

        try {
            const submitBtn = addUserForm.querySelector('.submit-btn');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating...';
            formError.classList.add('hidden');

            const isEdit = !!userToEdit;
            const url = isEdit ? `/api/admin/users/${userToEdit.id}` : '/api/admin/users';
            const method = isEdit ? 'PUT' : 'POST';

            const payload = { email, plan, status, max_devices: maxDevices };
            if (password) payload.password = password;

            const res = await fetch(url, {
                method,
                headers: getHeaders(),
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.status === 401) {
                sessionStorage.removeItem('adminPassword');
                checkAuth();
                throw new Error('Session expired. Please login again.');
            }

            // Success
            showToast(`User ${email} created successfully`, 'success');
            closeAllModals();
            addUserForm.reset();
            fetchUsers(); // Refresh list

        } catch (err) {
            formError.textContent = err.message;
            formError.classList.remove('hidden');
        } finally {
            const submitBtn = addUserForm.querySelector('.submit-btn');
            submitBtn.disabled = false;
            submitBtn.textContent = userToEdit ? 'Save Changes' : 'Create User';
        }
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        if (!userToDelete) return;

        try {
            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.textContent = 'Deleting...';

            const res = await fetch(`/api/admin/users/${userToDelete.id}`, {
                method: 'DELETE',
                headers: getHeaders()
            });

            const data = await res.json();

            if (res.status === 401) {
                sessionStorage.removeItem('adminPassword');
                checkAuth();
                throw new Error('Session expired');
            }

            if (!res.ok) {
                throw new Error(data.error || 'Failed to delete user');
            }

            showToast('User deleted successfully', 'success');
            closeAllModals();
            fetchUsers();

        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.textContent = 'Delete User';
        }
    });

    confirmLogoutBtn.addEventListener('click', async () => {
        if (!userToLogout) return;

        try {
            confirmLogoutBtn.disabled = true;
            confirmLogoutBtn.textContent = 'Logging out...';

            const res = await fetch(`/api/admin/users/${userToLogout.id}/logout`, {
                method: 'POST',
                headers: getHeaders()
            });

            const data = await res.json();

            if (res.status === 401) {
                sessionStorage.removeItem('adminPassword');
                checkAuth();
                throw new Error('Session expired');
            }

            if (!res.ok) {
                throw new Error(data.error || 'Failed to logout user');
            }

            showToast('User logged out from all devices', 'success');
            closeAllModals();
            fetchUsers();

        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            confirmLogoutBtn.disabled = false;
            confirmLogoutBtn.textContent = 'Force Logout';
        }
    });

    // --- Core Functions ---

    async function fetchUsers() {
        try {
            loadingSpinner.classList.remove('hidden');
            usersTbody.innerHTML = '';
            errorMessage.classList.add('hidden');

            const res = await fetch('/api/admin/users', {
                headers: getHeaders()
            });
            const data = await res.json();

            if (res.status === 401) {
                sessionStorage.removeItem('adminPassword');
                checkAuth();
                return;
            }

            if (!res.ok) throw new Error(data.error || 'Failed to fetch users');

            allUsers = data.users;
            renderUsers(allUsers);
        } catch (err) {
            errorMessage.textContent = err.message;
            errorMessage.classList.remove('hidden');
        } finally {
            loadingSpinner.classList.add('hidden');
        }
    }

    function renderUsers(users) {
        usersTbody.innerHTML = '';

        if (users.length === 0) {
            usersTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">No users found.</td></tr>`;
            return;
        }

        users.forEach(user => {
            const tr = document.createElement('tr');
            
            const createdAtLocale = new Date(user.created_at).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            });
            const lastLoginLocale = user.last_login 
                ? new Date(user.last_login).toLocaleDateString() 
                : '<span style="color:var(--text-secondary)">Never</span>';

            tr.innerHTML = `
                <td><strong>${escapeHTML(user.email)}</strong></td>
                <td><span class="plan-text">${escapeHTML(user.plan)}</span></td>
                <td><span class="badge status-${user.status}">${escapeHTML(user.status)}</span></td>
                <td>${user.active_sessions || 0} / ${user.max_devices}</td>
                <td>${lastLoginLocale}</td>
                <td>${createdAtLocale}</td>
                <td>
                    <button class="action-btn edit" data-id="${user.id}" title="Edit user">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="action-btn delete" data-id="${user.id}" data-email="${escapeHTML(user.email)}" title="Delete user">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                    <button class="action-btn logout" data-id="${user.id}" data-email="${escapeHTML(user.email)}" title="Force Logout Devices">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                    </button>
                </td>
            `;
            usersTbody.appendChild(tr);
        });

        // Attach event listeners
        document.querySelectorAll('.action-btn.edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const user = allUsers.find(u => u.id == id);
                if (user) promptEditUser(user);
            });
        });

        document.querySelectorAll('.action-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const id = target.getAttribute('data-id');
                const email = target.getAttribute('data-email');
                promptDeleteUser(id, email);
            });
        });

        document.querySelectorAll('.action-btn.logout').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const id = target.getAttribute('data-id');
                const email = target.getAttribute('data-email');
                promptLogoutUser(id, email);
            });
        });
    }

    function promptEditUser(user) {
        userToEdit = user;
        
        // Populate form
        document.getElementById('email').value = user.email;
        document.getElementById('password').value = ''; // Don't show old hash
        document.getElementById('password').required = false; // Optional password
        document.getElementById('plan').value = user.plan;
        document.getElementById('status').value = user.status;
        document.getElementById('max-devices').value = user.max_devices;

        addUserModal.querySelector('h3').textContent = 'Edit User';
        addUserForm.querySelector('.submit-btn').textContent = 'Save Changes';
        
        openModal(addUserModal);
    }

    function promptDeleteUser(id, email) {
        userToDelete = { id, email };
        deleteUserEmail.textContent = email;
        openModal(deleteModal);
    }

    function promptLogoutUser(id, email) {
        userToLogout = { id, email };
        logoutUserEmail.textContent = email;
        openModal(logoutModal);
    }

    function openModal(modal) {
        modal.classList.remove('hidden');
        // Prevent body scroll
        document.body.style.overflow = 'hidden';
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.classList.add('hidden');
        });
        document.body.style.overflow = '';
        formError.classList.add('hidden');
        userToDelete = null;
        userToEdit = null;
        userToLogout = null;
    }

    function showToast(message, type = 'success') {
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }
});
