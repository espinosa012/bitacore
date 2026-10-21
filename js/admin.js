/**
 * vg-task-manager: Administrator Panel Controller
 * Handles user management, project creation, task types customization,
 * and project tags management with cascading task updates.
 */
(function() {
  window.VG = window.VG || {};
  const UI = window.VG.UI;
  const MongoSync = window.VG.MongoSync;
  const escapeHtml = window.VG.Constants ? window.VG.Constants.escapeHtml : (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

  let activeAdminTab = 'users';
  let cachedProjects = [];

  function isAdminViewActive() {
    const adminView = document.getElementById('adminView');
    return adminView && !adminView.hidden && adminView.style.display !== 'none';
  }

  function showAdminView() {
    if (!window.VG.Auth || !window.VG.Auth.isAdmin()) {
      UI.toast('Administrator access required.', 'error');
      return;
    }

    const adminView = document.getElementById('adminView');
    const kanbanBoard = document.getElementById('kanbanBoard');
    const taskPage = document.getElementById('taskPage');
    const btnText = document.getElementById('btnAdminPanelText');
    const btnOpen = document.getElementById('btnOpenAdminPanel');

    // Hide task page if open
    if (taskPage && window.VG.TaskPage && window.VG.TaskPage.isOpen()) {
      window.VG.TaskPage.close();
    }

    // Hide tag explorer if open
    if (window.VG.TagExplorer && window.VG.TagExplorer.isOpen && window.VG.TagExplorer.isOpen()) {
      window.VG.TagExplorer.showBoardView();
    }

    if (kanbanBoard) kanbanBoard.style.display = 'none';
    const boardStatsBar = document.getElementById('boardStatsBar');
    if (boardStatsBar) boardStatsBar.style.display = 'none';
    if (adminView) {
      adminView.hidden = false;
      adminView.style.display = 'block';
    }

    if (btnText) btnText.textContent = 'Kanban Board';
    if (btnOpen) {
      const icon = btnOpen.querySelector('i.icon');
      if (icon) icon.className = 'columns icon';
      btnOpen.classList.add('active');
    }

    // Refresh projects list and active tab
    refreshActiveTab();
  }

  function showBoardView() {
    const adminView = document.getElementById('adminView');
    const kanbanBoard = document.getElementById('kanbanBoard');
    const boardStatsBar = document.getElementById('boardStatsBar');
    const btnText = document.getElementById('btnAdminPanelText');
    const btnOpen = document.getElementById('btnOpenAdminPanel');

    if (adminView) {
      adminView.hidden = true;
      adminView.style.display = 'none';
    }
    if (kanbanBoard) {
      kanbanBoard.style.display = 'flex';
    }
    if (boardStatsBar) {
      boardStatsBar.style.display = 'flex';
    }

    if (btnText) btnText.textContent = 'Admin Panel';
    if (btnOpen) {
      const icon = btnOpen.querySelector('i.icon');
      if (icon) icon.className = 'cogs icon';
      btnOpen.classList.remove('active');
    }

    if (window.VG.Board && window.VG.Board.renderBoard) {
      window.VG.Board.renderBoard();
    }
  }

  function toggleAdminView() {
    if (isAdminViewActive()) {
      showBoardView();
    } else {
      showAdminView();
    }
  }

  function switchAdminTab(tabName) {
    activeAdminTab = tabName;
    const tabMenu = document.getElementById('adminTabsMenu');
    if (tabMenu) {
      tabMenu.querySelectorAll('.item').forEach(el => {
        el.classList.toggle('active', el.dataset.adminTab === tabName);
      });
    }

    const panes = {
      users: document.getElementById('adminPaneUsers'),
      projects: document.getElementById('adminPaneProjects'),
      taskTypes: document.getElementById('adminPaneTaskTypes'),
      tags: document.getElementById('adminPaneTags')
    };

    Object.entries(panes).forEach(([name, pane]) => {
      if (pane) {
        pane.classList.toggle('active', name === tabName);
      }
    });

    refreshActiveTab();
  }

  async function loadCachedProjects() {
    try {
      cachedProjects = await MongoSync.fetchProjects(['*']);
    } catch (err) {
      console.warn('[Admin] Error fetching projects:', err.message);
      cachedProjects = [];
    }
    return cachedProjects;
  }

  async function refreshActiveTab() {
    await loadCachedProjects();
    switch (activeAdminTab) {
      case 'users':
        await renderUsersTab();
        break;
      case 'projects':
        await renderProjectsTab();
        break;
      case 'taskTypes':
        populateTaskTypeProjectSelector();
        await renderTaskTypesTab();
        break;
      case 'tags':
        populateTagProjectSelector();
        await renderTagsTab();
        break;
    }
  }

  /* -------------------------------------------------------------
   * 1. USERS TAB
   * ------------------------------------------------------------- */

  async function renderUsersTab() {
    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;"><i class="spinner loading icon"></i> Loading users...</td></tr>';

    try {
      const users = await window.VG.Auth.fetchUsers();
      if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;">No users found in database.</td></tr>';
        return;
      }

      const currentUser = window.VG.Auth.getCurrentUser();
      const currentUsername = currentUser ? currentUser.username.toLowerCase() : '';

      tbody.innerHTML = users.map(u => {
        const isAdmin = Boolean(u.isAdmin);
        const roleBadge = isAdmin
          ? '<span class="ui mini teal label"><i class="shield alternate icon"></i> Administrator</span>'
          : '<span class="ui mini grey label"><i class="user outline icon"></i> Regular User</span>';

        let projectsHtml = '';
        if (isAdmin) {
          projectsHtml = '<span class="ui mini basic teal label"><i class="globe icon"></i> All Projects (Global)</span>';
        } else if (Array.isArray(u.projects) && u.projects.length > 0) {
          projectsHtml = u.projects.map(pid => {
            const p = cachedProjects.find(cp => cp.id === pid);
            const label = p ? p.name : pid;
            return `<span class="ui mini basic label" style="margin: 2px;">${escapeHtml(label)}</span>`;
          }).join(' ');
        } else {
          projectsHtml = '<em style="color: #718096;">None assigned</em>';
        }

        const dateStr = u.createdAt ? new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
        const isSelf = u.username.toLowerCase() === currentUsername;

        return `
          <tr data-username="${escapeHtml(u.username)}">
            <td style="font-weight: 600; color: #edf2f7;">
              <i class="user circle outline icon"></i> ${escapeHtml(u.username)}
              ${isSelf ? ' <span style="font-size: 0.8rem; color: #00b5ad;">(you)</span>' : ''}
            </td>
            <td>${roleBadge}</td>
            <td>${projectsHtml}</td>
            <td style="color: #a0aec0; font-size: 0.85rem;">${escapeHtml(dateStr)}</td>
            <td class="right aligned">
              <button type="button" class="ui mini basic inverted teal button btn-edit-user" data-username="${escapeHtml(u.username)}">
                <i class="edit icon"></i> Edit
              </button>
              <button type="button" class="ui mini basic inverted red button btn-delete-user" data-username="${escapeHtml(u.username)}" ${isSelf ? 'disabled title="Cannot delete your own account"' : ''}>
                <i class="trash alternate icon"></i> Delete
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Wire action buttons
      tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
        btn.addEventListener('click', () => {
          const uname = btn.dataset.username;
          const userObj = users.find(u => u.username === uname);
          if (userObj) openEditUserModal(userObj);
        });
      });

      tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uname = btn.dataset.username;
          if (!uname) return;
          const confirmed = await UI.confirm(`Are you sure you want to permanently delete user "${uname}"?`, {
            title: 'Delete User Account',
            okText: 'Delete User',
            danger: true
          });
          if (!confirmed) return;

          try {
            await window.VG.Auth.adminDeleteUser(uname);
            UI.toast(`User "${uname}" has been deleted.`, 'success');
            await renderUsersTab();
            const refreshedUsers = await window.VG.Auth.fetchUsers();
            if (window.VG.Modals && window.VG.Modals.populateUserDropdowns) {
              window.VG.Modals.populateUserDropdowns(refreshedUsers);
            }
          } catch (err) {
            UI.toast(`Failed to delete user: ${err.message}`, 'error', 6000);
          }
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="color: #e53e3e;">Failed to load users: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function openCreateUserModal() {
    const modal = document.getElementById('modalAdminCreateUser');
    if (!modal) return;

    const uInput = document.getElementById('adminNewUsername');
    const pInput = document.getElementById('adminNewPassword');
    const adminChk = document.getElementById('adminNewIsAdmin');
    const listEl = document.getElementById('adminNewUserProjectsList');
    const errBox = document.getElementById('adminCreateUserError');

    if (uInput) uInput.value = '';
    if (pInput) pInput.value = '';
    if (adminChk) adminChk.checked = false;
    if (errBox) errBox.style.display = 'none';

    // Populate project checkboxes
    if (listEl) {
      listEl.innerHTML = cachedProjects.map(p => `
        <label class="admin-project-chip">
          <input type="checkbox" name="adminNewUserProjects" value="${escapeHtml(p.id)}" ${p.id === 'project-ludum' ? 'checked' : ''} />
          <span>${escapeHtml(p.name)} (${escapeHtml(p.id)})</span>
        </label>
      `).join('');
    }

    UI.showModal(modal);
    setTimeout(() => uInput && uInput.focus(), 50);
  }

  function closeCreateUserModal() {
    const modal = document.getElementById('modalAdminCreateUser');
    if (modal && UI.isModalVisible(modal)) UI.hideModal(modal);
  }

  async function handleCreateUserSubmit() {
    const uInput = document.getElementById('adminNewUsername');
    const pInput = document.getElementById('adminNewPassword');
    const adminChk = document.getElementById('adminNewIsAdmin');
    const errBox = document.getElementById('adminCreateUserError');
    const errText = document.getElementById('adminCreateUserErrorText');
    const submitBtn = document.getElementById('btnSubmitAdminCreateUser');

    const uname = (uInput ? uInput.value : '').trim();
    const pwd = pInput ? pInput.value : '';
    const isAdmin = adminChk ? adminChk.checked : false;

    const checkedProjects = Array.from(document.querySelectorAll('input[name="adminNewUserProjects"]:checked'))
      .map(cb => cb.value);

    if (errBox) errBox.style.display = 'none';

    if (!uname || uname.length < 2) {
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = 'Username must be at least 2 characters long.';
      }
      return;
    }
    if (!pwd || pwd.length < 3) {
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = 'Password must be at least 3 characters long.';
      }
      return;
    }

    if (submitBtn) submitBtn.classList.add('loading');

    try {
      await window.VG.Auth.adminCreateUser(uname, pwd, checkedProjects, isAdmin);
      if (submitBtn) submitBtn.classList.remove('loading');
      closeCreateUserModal();
      UI.toast(`User "${uname}" created successfully.`, 'success');
      await renderUsersTab();
      const refreshedUsers = await window.VG.Auth.fetchUsers();
      if (window.VG.Modals && window.VG.Modals.populateUserDropdowns) {
        window.VG.Modals.populateUserDropdowns(refreshedUsers);
      }
    } catch (err) {
      if (submitBtn) submitBtn.classList.remove('loading');
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = err.message || 'Failed to create user.';
      }
    }
  }

  function openEditUserModal(userObj) {
    const modal = document.getElementById('modalAdminEditUser');
    if (!modal || !userObj) return;

    const uInput = document.getElementById('adminEditUsername');
    const pInput = document.getElementById('adminEditPassword');
    const adminChk = document.getElementById('adminEditIsAdmin');
    const listEl = document.getElementById('adminEditUserProjectsList');
    const errBox = document.getElementById('adminEditUserError');

    if (uInput) uInput.value = userObj.username;
    if (pInput) pInput.value = '';
    if (adminChk) adminChk.checked = Boolean(userObj.isAdmin);
    if (errBox) errBox.style.display = 'none';

    const userProjects = Array.isArray(userObj.projects) ? userObj.projects : [];

    if (listEl) {
      listEl.innerHTML = cachedProjects.map(p => {
        const checked = userProjects.includes(p.id) ? 'checked' : '';
        return `
          <label class="admin-project-chip">
            <input type="checkbox" name="adminEditUserProjects" value="${escapeHtml(p.id)}" ${checked} />
            <span>${escapeHtml(p.name)} (${escapeHtml(p.id)})</span>
          </label>
        `;
      }).join('');
    }

    UI.showModal(modal);
  }

  function closeEditUserModal() {
    const modal = document.getElementById('modalAdminEditUser');
    if (modal && UI.isModalVisible(modal)) UI.hideModal(modal);
  }

  async function handleEditUserSubmit() {
    const uInput = document.getElementById('adminEditUsername');
    const pInput = document.getElementById('adminEditPassword');
    const adminChk = document.getElementById('adminEditIsAdmin');
    const errBox = document.getElementById('adminEditUserError');
    const errText = document.getElementById('adminEditUserErrorText');
    const submitBtn = document.getElementById('btnSubmitAdminEditUser');

    const uname = uInput ? uInput.value.trim() : '';
    const newPwd = pInput ? pInput.value.trim() : '';
    const isAdmin = adminChk ? adminChk.checked : false;

    const checkedProjects = Array.from(document.querySelectorAll('input[name="adminEditUserProjects"]:checked'))
      .map(cb => cb.value);

    if (errBox) errBox.style.display = 'none';
    if (submitBtn) submitBtn.classList.add('loading');

    const updateData = {
      projects: checkedProjects,
      isAdmin: isAdmin
    };
    if (newPwd) {
      if (newPwd.length < 3) {
        if (submitBtn) submitBtn.classList.remove('loading');
        if (errBox && errText) {
          errBox.style.display = 'block';
          errText.textContent = 'Password must be at least 3 characters long.';
        }
        return;
      }
      updateData.password = newPwd;
    }

    try {
      await window.VG.Auth.adminUpdateUser(uname, updateData);
      if (submitBtn) submitBtn.classList.remove('loading');
      closeEditUserModal();
      UI.toast(`User "${uname}" updated successfully.`, 'success');
      await renderUsersTab();
      const refreshedUsers = await window.VG.Auth.fetchUsers();
      if (window.VG.Modals && window.VG.Modals.populateUserDropdowns) {
        window.VG.Modals.populateUserDropdowns(refreshedUsers);
      }
    } catch (err) {
      if (submitBtn) submitBtn.classList.remove('loading');
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = err.message || 'Failed to update user.';
      }
    }
  }

  /* -------------------------------------------------------------
   * 2. PROJECTS TAB
   * ------------------------------------------------------------- */

  async function renderProjectsTab() {
    const tbody = document.getElementById('adminProjectsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;"><i class="spinner loading icon"></i> Loading projects...</td></tr>';

    try {
      const projects = await loadCachedProjects();
      if (!projects || projects.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;">No projects found in database.</td></tr>';
        return;
      }

      tbody.innerHTML = projects.map(p => {
        const format = p['task-id-format'] || p.taskIdFormat || `${p.id}-`;
        const dateStr = p.createdAt ? (p.createdAt.$date ? new Date(p.createdAt.$date).toLocaleDateString() : new Date(p.createdAt).toLocaleDateString()) : '—';

        return `
          <tr>
            <td style="font-weight: 600; color: #00b5ad; font-family: monospace;">${escapeHtml(p.id)}</td>
            <td style="font-weight: 600; color: #edf2f7;">${escapeHtml(p.name)}</td>
            <td><span class="ui mini basic teal label" style="font-family: monospace;">${escapeHtml(format)}</span></td>
            <td style="color: #a0aec0; font-size: 0.85rem;">${escapeHtml(p.description || '—')}</td>
            <td class="right aligned" style="color: #718096; font-size: 0.85rem;">${escapeHtml(dateStr)}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="color: #e53e3e;">Failed to load projects: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function openCreateProjectModal() {
    const modal = document.getElementById('modalAdminCreateProject');
    if (!modal) return;

    const idInput = document.getElementById('adminNewProjectId');
    const nameInput = document.getElementById('adminNewProjectName');
    const descInput = document.getElementById('adminNewProjectDesc');
    const errBox = document.getElementById('adminCreateProjectError');

    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (errBox) errBox.style.display = 'none';

    UI.showModal(modal);
    setTimeout(() => idInput && idInput.focus(), 50);
  }

  function closeCreateProjectModal() {
    const modal = document.getElementById('modalAdminCreateProject');
    if (modal && UI.isModalVisible(modal)) UI.hideModal(modal);
  }

  async function handleCreateProjectSubmit() {
    const idInput = document.getElementById('adminNewProjectId');
    const nameInput = document.getElementById('adminNewProjectName');
    const descInput = document.getElementById('adminNewProjectDesc');
    const errBox = document.getElementById('adminCreateProjectError');
    const errText = document.getElementById('adminCreateProjectErrorText');
    const submitBtn = document.getElementById('btnSubmitAdminCreateProject');

    const id = idInput ? idInput.value.trim() : '';
    const name = nameInput ? nameInput.value.trim() : '';
    const desc = descInput ? descInput.value.trim() : '';

    if (errBox) errBox.style.display = 'none';

    if (!id || !name) {
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = 'Project ID and Project Display Name are required.';
      }
      return;
    }

    if (submitBtn) submitBtn.classList.add('loading');

    try {
      await MongoSync.createProject({ id, name, description: desc });
      if (submitBtn) submitBtn.classList.remove('loading');
      closeCreateProjectModal();
      UI.toast(`Project "${name}" (${id}) created and seeded successfully.`, 'success');

      await renderProjectsTab();

      // Refresh application project selector
      if (window.VG.App && window.VG.App.populateProjectSelector) {
        await window.VG.App.populateProjectSelector();
      }
      populateTaskTypeProjectSelector();
      populateTagProjectSelector();
    } catch (err) {
      if (submitBtn) submitBtn.classList.remove('loading');
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = err.message || 'Failed to create project.';
      }
    }
  }

  /* -------------------------------------------------------------
   * 3. TASK TYPES TAB
   * ------------------------------------------------------------- */

  function populateTaskTypeProjectSelector() {
    const select = document.getElementById('adminTaskTypeProjectSelect');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = cachedProjects.map(p =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.id)})</option>`
    ).join('');

    if (currentVal && cachedProjects.some(p => p.id === currentVal)) {
      select.value = currentVal;
    } else if (cachedProjects.length > 0) {
      select.value = cachedProjects[0].id;
    }
  }

  async function renderTaskTypesTab() {
    const select = document.getElementById('adminTaskTypeProjectSelect');
    const targetProject = select ? select.value : (cachedProjects[0] ? cachedProjects[0].id : null);
    const tbody = document.getElementById('adminTaskTypesTableBody');
    if (!tbody) return;

    if (!targetProject) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;">Select a project to view task types.</td></tr>';
      return;
    }

    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;"><i class="spinner loading icon"></i> Loading task types...</td></tr>';

    try {
      const types = await MongoSync.fetchProjectTaskTypes(targetProject);
      if (!types || types.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;">No task types found for this project.</td></tr>';
        return;
      }

      tbody.innerHTML = types.map(t => {
        const isDefault = t.id === 'task';
        const color = t.color || 'blue';
        const icon = t.icon || 'check square outline';

        return `
          <tr data-type-id="${escapeHtml(t.id)}">
            <td style="font-weight: 600; font-family: monospace; color: #edf2f7;">
              ${escapeHtml(t.id)}
              ${isDefault ? ' <span class="ui mini label" style="margin-left: 6px;">default</span>' : ''}
            </td>
            <td style="font-weight: 600;">${escapeHtml(t.name || t.label || t.id)}</td>
            <td>
              <i class="${escapeHtml(icon)} icon" style="margin-right: 6px;"></i>
              <span style="color: #a0aec0; font-family: monospace; font-size: 0.85rem;">${escapeHtml(icon)}</span>
            </td>
            <td>
              <span class="ui mini ${escapeHtml(color)} label">${escapeHtml(color)}</span>
            </td>
            <td class="right aligned">
              <button type="button" class="ui mini basic inverted teal button btn-edit-task-type"
                data-id="${escapeHtml(t.id)}"
                data-name="${escapeHtml(t.name || t.label || t.id)}"
                data-icon="${escapeHtml(icon)}"
                data-color="${escapeHtml(color)}">
                <i class="edit icon"></i> Edit
              </button>
              <button type="button" class="ui mini basic inverted red button btn-delete-task-type"
                data-id="${escapeHtml(t.id)}"
                ${isDefault ? 'disabled title="Default task type cannot be deleted"' : ''}>
                <i class="trash alternate icon"></i> Delete
              </button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.btn-edit-task-type').forEach(btn => {
        btn.addEventListener('click', () => {
          openTaskTypeModal({
            isEdit: true,
            id: btn.dataset.id,
            name: btn.dataset.name,
            icon: btn.dataset.icon,
            color: btn.dataset.color
          });
        });
      });

      tbody.querySelectorAll('.btn-delete-task-type').forEach(btn => {
        btn.addEventListener('click', async () => {
          const typeId = btn.dataset.id;
          if (!typeId || typeId === 'task') return;

          const confirmed = await UI.confirm(
            `Are you sure you want to delete task type "${typeId}"? All existing tasks in this project with this type will be automatically reassigned to the default "task" type.`,
            {
              title: 'Delete Task Type',
              okText: 'Delete and Reassign Tasks',
              danger: true
            }
          );
          if (!confirmed) return;

          try {
            await MongoSync.deleteProjectTaskType(targetProject, typeId);
            UI.toast(`Task type "${typeId}" deleted and existing tasks reassigned to "task".`, 'success');
            await renderTaskTypesTab();

            // If targetProject is currently active board project, refresh board task types and reload tasks
            if (targetProject === MongoSync.getCurrentProject()) {
              const refreshedTypes = await MongoSync.fetchProjectTaskTypes(targetProject);
              window.VG.Constants.updateTaskTypes(refreshedTypes);
              if (window.VG.App && window.VG.App.refreshTaskTypeDropdowns) {
                window.VG.App.refreshTaskTypeDropdowns();
              }
              if (window.VG.App && window.VG.App.loadFromMongo) {
                await window.VG.App.loadFromMongo();
              }
            }
          } catch (err) {
            UI.toast(`Failed to delete task type: ${err.message}`, 'error', 6000);
          }
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="color: #e53e3e;">Failed to load task types: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function openTaskTypeModal(config = {}) {
    const modal = document.getElementById('modalAdminTaskType');
    if (!modal) return;

    const isEdit = Boolean(config.isEdit);
    const titleEl = document.getElementById('modalAdminTaskTypeTitle');
    const isEditInput = document.getElementById('adminTaskTypeIsEdit');
    const idInput = document.getElementById('adminTaskTypeId');
    const nameInput = document.getElementById('adminTaskTypeName');
    const iconInput = document.getElementById('adminTaskTypeIcon');
    const colorSelect = document.getElementById('adminTaskTypeColor');
    const errBox = document.getElementById('adminTaskTypeError');

    if (titleEl) {
      titleEl.innerHTML = `<i class="shapes icon"></i> ${isEdit ? 'Edit Task Type' : 'Add Task Type'}`;
    }
    if (isEditInput) isEditInput.value = isEdit ? '1' : '0';
    if (idInput) {
      idInput.value = config.id || '';
      idInput.readOnly = isEdit;
      idInput.style.opacity = isEdit ? '0.75' : '1';
    }
    if (nameInput) nameInput.value = config.name || '';
    if (iconInput) iconInput.value = config.icon || 'check square outline';
    if (colorSelect) colorSelect.value = config.color || 'blue';
    if (errBox) errBox.style.display = 'none';

    UI.showModal(modal);
    setTimeout(() => {
      if (!isEdit && idInput) idInput.focus();
      else if (nameInput) nameInput.focus();
    }, 50);
  }

  function closeTaskTypeModal() {
    const modal = document.getElementById('modalAdminTaskType');
    if (modal && UI.isModalVisible(modal)) UI.hideModal(modal);
  }

  async function handleTaskTypeSubmit() {
    const select = document.getElementById('adminTaskTypeProjectSelect');
    const targetProject = select ? select.value : (cachedProjects[0] ? cachedProjects[0].id : null);
    if (!targetProject) {
      UI.toast('No project selected.', 'error');
      return;
    }

    const isEdit = document.getElementById('adminTaskTypeIsEdit')?.value === '1';
    const idInput = document.getElementById('adminTaskTypeId');
    const nameInput = document.getElementById('adminTaskTypeName');
    const iconInput = document.getElementById('adminTaskTypeIcon');
    const colorSelect = document.getElementById('adminTaskTypeColor');
    const errBox = document.getElementById('adminTaskTypeError');
    const errText = document.getElementById('adminTaskTypeErrorText');
    const submitBtn = document.getElementById('btnSubmitAdminTaskType');

    const typeId = (idInput ? idInput.value : '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const typeName = (nameInput ? nameInput.value : '').trim();
    const icon = (iconInput ? iconInput.value : '').trim() || 'check square outline';
    const color = (colorSelect ? colorSelect.value : 'blue');

    if (errBox) errBox.style.display = 'none';

    if (!typeId || !typeName) {
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = 'Type ID and Display Name are required.';
      }
      return;
    }

    if (submitBtn) submitBtn.classList.add('loading');

    try {
      await MongoSync.saveProjectTaskType(targetProject, {
        id: typeId,
        name: typeName,
        icon: icon,
        color: color
      });

      if (submitBtn) submitBtn.classList.remove('loading');
      closeTaskTypeModal();
      UI.toast(`Task type "${typeName}" (${typeId}) saved.`, 'success');

      await renderTaskTypesTab();

      // If updating currently active board project, update constants and dropdowns
      if (targetProject === MongoSync.getCurrentProject()) {
        const refreshedTypes = await MongoSync.fetchProjectTaskTypes(targetProject);
        window.VG.Constants.updateTaskTypes(refreshedTypes);
        if (window.VG.App && window.VG.App.refreshTaskTypeDropdowns) {
          window.VG.App.refreshTaskTypeDropdowns();
        }
      }
    } catch (err) {
      if (submitBtn) submitBtn.classList.remove('loading');
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = err.message || 'Failed to save task type.';
      }
    }
  }

  /* -------------------------------------------------------------
   * 4. TAGS TAB
   * ------------------------------------------------------------- */

  function populateTagProjectSelector() {
    const select = document.getElementById('adminTagProjectSelect');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = cachedProjects.map(p =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.id)})</option>`
    ).join('');

    if (currentVal && cachedProjects.some(p => p.id === currentVal)) {
      select.value = currentVal;
    } else if (cachedProjects.length > 0) {
      select.value = cachedProjects[0].id;
    }
  }

  async function renderTagsTab() {
    const select = document.getElementById('adminTagProjectSelect');
    const targetProject = select ? select.value : (cachedProjects[0] ? cachedProjects[0].id : null);
    const tbody = document.getElementById('adminTagsTableBody');
    if (!tbody) return;

    if (!targetProject) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;">Select a project to view tags.</td></tr>';
      return;
    }

    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;"><i class="spinner loading icon"></i> Loading tags and usage counts...</td></tr>';

    try {
      const tags = await MongoSync.fetchProjectTags(targetProject);
      if (!tags || tags.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #a0aec0;">No tags registered in this project. Click "Add Tag" to create one.</td></tr>';
        return;
      }

      tbody.innerHTML = tags.map(t => {
        const name = t.name;
        const color = t.color || 'blue';
        const count = t.taskCount || 0;

        return `
          <tr data-tag-name="${escapeHtml(name)}">
            <td style="font-weight: 600; color: #edf2f7;">${escapeHtml(name)}</td>
            <td>
              <span class="ui ${escapeHtml(color)} label">${escapeHtml(name)}</span>
            </td>
            <td>
              <span class="ui mini ${escapeHtml(color)} basic label">${escapeHtml(color)}</span>
            </td>
            <td>
              <span class="ui mini basic label" style="font-weight: 600;">
                <i class="tasks icon"></i> ${count} task${count === 1 ? '' : 's'}
              </span>
            </td>
            <td class="right aligned">
              <button type="button" class="ui mini basic inverted teal button btn-edit-tag"
                data-name="${escapeHtml(name)}"
                data-color="${escapeHtml(color)}">
                <i class="edit icon"></i> Edit / Rename
              </button>
              <button type="button" class="ui mini basic inverted red button btn-delete-tag"
                data-name="${escapeHtml(name)}"
                data-count="${count}">
                <i class="trash alternate icon"></i> Delete
              </button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.btn-edit-tag').forEach(btn => {
        btn.addEventListener('click', () => {
          openTagModal({
            isEdit: true,
            oldName: btn.dataset.name,
            name: btn.dataset.name,
            color: btn.dataset.color
          });
        });
      });

      tbody.querySelectorAll('.btn-delete-tag').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tagName = btn.dataset.name;
          const count = Number(btn.dataset.count) || 0;
          if (!tagName) return;

          const promptMsg = count > 0
            ? `Are you sure you want to delete tag "${tagName}"? It will be automatically removed from all ${count} tasks in this project.`
            : `Are you sure you want to delete tag "${tagName}"?`;

          const confirmed = await UI.confirm(promptMsg, {
            title: 'Delete Tag',
            okText: 'Delete and Remove from Tasks',
            danger: true
          });
          if (!confirmed) return;

          try {
            await MongoSync.deleteProjectTag(targetProject, tagName);
            UI.toast(`Tag "${tagName}" deleted and removed from tasks.`, 'success');
            await renderTagsTab();

            // If targetProject is currently active board project, reload board
            if (targetProject === MongoSync.getCurrentProject() && window.VG.App && window.VG.App.loadFromMongo) {
              await window.VG.App.loadFromMongo();
            }
          } catch (err) {
            UI.toast(`Failed to delete tag: ${err.message}`, 'error', 6000);
          }
        });
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="color: #e53e3e;">Failed to load tags: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function openTagModal(config = {}) {
    const modal = document.getElementById('modalAdminTag');
    if (!modal) return;

    const isEdit = Boolean(config.isEdit);
    const titleEl = document.getElementById('modalAdminTagTitle');
    const isEditInput = document.getElementById('adminTagIsEdit');
    const oldNameInput = document.getElementById('adminTagOldName');
    const nameInput = document.getElementById('adminTagName');
    const colorSelect = document.getElementById('adminTagColor');
    const renameNote = document.getElementById('adminTagRenameNote');
    const errBox = document.getElementById('adminTagError');

    if (titleEl) {
      titleEl.innerHTML = `<i class="tags icon"></i> ${isEdit ? 'Rename / Edit Tag' : 'Add Tag'}`;
    }
    if (isEditInput) isEditInput.value = isEdit ? '1' : '0';
    if (oldNameInput) oldNameInput.value = config.oldName || '';
    if (nameInput) nameInput.value = config.name || '';
    if (colorSelect) colorSelect.value = config.color || 'blue';
    if (renameNote) renameNote.style.display = isEdit ? 'block' : 'none';
    if (errBox) errBox.style.display = 'none';

    UI.showModal(modal);
    setTimeout(() => nameInput && nameInput.focus(), 50);
  }

  function closeTagModal() {
    const modal = document.getElementById('modalAdminTag');
    if (modal && UI.isModalVisible(modal)) UI.hideModal(modal);
  }

  async function handleTagSubmit() {
    const select = document.getElementById('adminTagProjectSelect');
    const targetProject = select ? select.value : (cachedProjects[0] ? cachedProjects[0].id : null);
    if (!targetProject) {
      UI.toast('No project selected.', 'error');
      return;
    }

    const isEdit = document.getElementById('adminTagIsEdit')?.value === '1';
    const oldName = (document.getElementById('adminTagOldName')?.value || '').trim();
    const newName = (document.getElementById('adminTagName')?.value || '').trim();
    const color = document.getElementById('adminTagColor')?.value || 'blue';
    const errBox = document.getElementById('adminTagError');
    const errText = document.getElementById('adminTagErrorText');
    const submitBtn = document.getElementById('btnSubmitAdminTag');

    if (errBox) errBox.style.display = 'none';

    if (!newName) {
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = 'Tag name is required.';
      }
      return;
    }

    if (submitBtn) submitBtn.classList.add('loading');

    try {
      if (isEdit) {
        await MongoSync.updateProjectTag(targetProject, oldName, newName, color);
        UI.toast(`Tag "${oldName}" updated and cascaded to all tasks in project.`, 'success');
      } else {
        await MongoSync.addProjectTag(targetProject, newName, color);
        UI.toast(`Tag "${newName}" created.`, 'success');
      }

      if (submitBtn) submitBtn.classList.remove('loading');
      closeTagModal();

      await renderTagsTab();

      // If targetProject is currently active board project, reload board
      if (targetProject === MongoSync.getCurrentProject() && window.VG.App && window.VG.App.loadFromMongo) {
        await window.VG.App.loadFromMongo();
      }
    } catch (err) {
      if (submitBtn) submitBtn.classList.remove('loading');
      if (errBox && errText) {
        errBox.style.display = 'block';
        errText.textContent = err.message || 'Failed to save tag.';
      }
    }
  }

  /* -------------------------------------------------------------
   * INITIALIZATION & EVENT BINDINGS
   * ------------------------------------------------------------- */

  function initAdmin() {
    // 1. Modals initialization
    UI.initModal('#modalAdminCreateUser', { autofocus: false });
    UI.initModal('#modalAdminEditUser', { autofocus: false });
    UI.initModal('#modalAdminCreateProject', { autofocus: false });
    UI.initModal('#modalAdminTaskType', { autofocus: false });
    UI.initModal('#modalAdminTag', { autofocus: false });

    // 2. Header and Session toggle buttons
    const btnOpenAdmin = document.getElementById('btnOpenAdminPanel');
    if (btnOpenAdmin) {
      btnOpenAdmin.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAdminView();
      });
    }

    const btnBackToBoard = document.getElementById('btnAdminBackToBoard');
    if (btnBackToBoard) {
      btnBackToBoard.addEventListener('click', (e) => {
        e.preventDefault();
        showBoardView();
      });
    }

    const btnSessionAdmin = document.getElementById('btnSessionAdminPanel');
    if (btnSessionAdmin) {
      btnSessionAdmin.addEventListener('click', (e) => {
        e.preventDefault();
        const sessionPopover = document.getElementById('userSessionPopover');
        if (sessionPopover) sessionPopover.style.display = 'none';
        showAdminView();
      });
    }

    // 3. Tab switching
    const tabMenu = document.getElementById('adminTabsMenu');
    if (tabMenu) {
      tabMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.item');
        if (!item || !item.dataset.adminTab) return;
        e.preventDefault();
        switchAdminTab(item.dataset.adminTab);
      });
    }

    // 4. Users Pane Event Listeners
    const btnOpenCreateUser = document.getElementById('btnAdminOpenCreateUser');
    if (btnOpenCreateUser) btnOpenCreateUser.addEventListener('click', openCreateUserModal);

    const btnRefreshUsers = document.getElementById('btnAdminRefreshUsers');
    if (btnRefreshUsers) btnRefreshUsers.addEventListener('click', () => renderUsersTab());

    const closeCreateUserBtn = document.getElementById('closeAdminCreateUserBtn');
    if (closeCreateUserBtn) closeCreateUserBtn.addEventListener('click', closeCreateUserModal);

    const cancelCreateUserBtn = document.getElementById('btnCancelAdminCreateUser');
    if (cancelCreateUserBtn) cancelCreateUserBtn.addEventListener('click', closeCreateUserModal);

    const submitCreateUserBtn = document.getElementById('btnSubmitAdminCreateUser');
    if (submitCreateUserBtn) submitCreateUserBtn.addEventListener('click', handleCreateUserSubmit);

    const formCreateUser = document.getElementById('formAdminCreateUser');
    if (formCreateUser) formCreateUser.addEventListener('submit', (e) => { e.preventDefault(); handleCreateUserSubmit(); });

    const closeEditUserBtn = document.getElementById('closeAdminEditUserBtn');
    if (closeEditUserBtn) closeEditUserBtn.addEventListener('click', closeEditUserModal);

    const cancelEditUserBtn = document.getElementById('btnCancelAdminEditUser');
    if (cancelEditUserBtn) cancelEditUserBtn.addEventListener('click', closeEditUserModal);

    const submitEditUserBtn = document.getElementById('btnSubmitAdminEditUser');
    if (submitEditUserBtn) submitEditUserBtn.addEventListener('click', handleEditUserSubmit);

    const formEditUser = document.getElementById('formAdminEditUser');
    if (formEditUser) formEditUser.addEventListener('submit', (e) => { e.preventDefault(); handleEditUserSubmit(); });

    // 5. Projects Pane Event Listeners
    const btnOpenCreateProject = document.getElementById('btnAdminOpenCreateProject');
    if (btnOpenCreateProject) btnOpenCreateProject.addEventListener('click', openCreateProjectModal);

    const btnRefreshProjects = document.getElementById('btnAdminRefreshProjects');
    if (btnRefreshProjects) btnRefreshProjects.addEventListener('click', () => renderProjectsTab());

    const closeCreateProjectBtn = document.getElementById('closeAdminCreateProjectBtn');
    if (closeCreateProjectBtn) closeCreateProjectBtn.addEventListener('click', closeCreateProjectModal);

    const cancelCreateProjectBtn = document.getElementById('btnCancelAdminCreateProject');
    if (cancelCreateProjectBtn) cancelCreateProjectBtn.addEventListener('click', closeCreateProjectModal);

    const submitCreateProjectBtn = document.getElementById('btnSubmitAdminCreateProject');
    if (submitCreateProjectBtn) submitCreateProjectBtn.addEventListener('click', handleCreateProjectSubmit);

    const formCreateProject = document.getElementById('formAdminCreateProject');
    if (formCreateProject) formCreateProject.addEventListener('submit', (e) => { e.preventDefault(); handleCreateProjectSubmit(); });

    // 6. Task Types Pane Event Listeners
    const taskTypeSelect = document.getElementById('adminTaskTypeProjectSelect');
    if (taskTypeSelect) {
      taskTypeSelect.addEventListener('change', () => renderTaskTypesTab());
    }

    const btnOpenCreateTaskType = document.getElementById('btnAdminOpenCreateTaskType');
    if (btnOpenCreateTaskType) btnOpenCreateTaskType.addEventListener('click', () => openTaskTypeModal({ isEdit: false }));

    const btnRefreshTaskTypes = document.getElementById('btnAdminRefreshTaskTypes');
    if (btnRefreshTaskTypes) btnRefreshTaskTypes.addEventListener('click', () => renderTaskTypesTab());

    const closeTaskTypeBtn = document.getElementById('closeAdminTaskTypeBtn');
    if (closeTaskTypeBtn) closeTaskTypeBtn.addEventListener('click', closeTaskTypeModal);

    const cancelTaskTypeBtn = document.getElementById('btnCancelAdminTaskType');
    if (cancelTaskTypeBtn) cancelTaskTypeBtn.addEventListener('click', closeTaskTypeModal);

    const submitTaskTypeBtn = document.getElementById('btnSubmitAdminTaskType');
    if (submitTaskTypeBtn) submitTaskTypeBtn.addEventListener('click', handleTaskTypeSubmit);

    const formTaskType = document.getElementById('formAdminTaskType');
    if (formTaskType) formTaskType.addEventListener('submit', (e) => { e.preventDefault(); handleTaskTypeSubmit(); });

    // 7. Tags Pane Event Listeners
    const tagSelect = document.getElementById('adminTagProjectSelect');
    if (tagSelect) {
      tagSelect.addEventListener('change', () => renderTagsTab());
    }

    const btnOpenCreateTag = document.getElementById('btnAdminOpenCreateTag');
    if (btnOpenCreateTag) btnOpenCreateTag.addEventListener('click', () => openTagModal({ isEdit: false }));

    const btnRefreshTags = document.getElementById('btnAdminRefreshTags');
    if (btnRefreshTags) btnRefreshTags.addEventListener('click', () => renderTagsTab());

    const closeTagBtn = document.getElementById('closeAdminTagBtn');
    if (closeTagBtn) closeTagBtn.addEventListener('click', closeTagModal);

    const cancelTagBtn = document.getElementById('btnCancelAdminTag');
    if (cancelTagBtn) cancelTagBtn.addEventListener('click', closeTagModal);

    const submitTagBtn = document.getElementById('btnSubmitAdminTag');
    if (submitTagBtn) submitTagBtn.addEventListener('click', handleTagSubmit);

    const formTag = document.getElementById('formAdminTag');
    if (formTag) formTag.addEventListener('submit', (e) => { e.preventDefault(); handleTagSubmit(); });
  }

  window.VG.Admin = {
    init: initAdmin,
    showAdminView,
    showBoardView,
    toggleAdminView,
    isAdminViewActive,
    switchAdminTab,
    refreshActiveTab,
    renderUsersTab,
    renderProjectsTab,
    renderTaskTypesTab,
    renderTagsTab
  };
})();
