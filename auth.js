// Pure client-side auth/order/search system using localStorage
(function() {
  'use strict';

  // Storage keys
  var STORAGE_USERS = 'mm_users';
  var STORAGE_CURRENT_USER = 'mm_current_user';
  var STORAGE_RESTAURANTS = 'mm_restaurants';
  var STORAGE_MENU_ITEMS = 'mm_menu_items';
  var STORAGE_ORDERS = 'mm_orders';
  var STORAGE_ORDER_ID_COUNTER = 'mm_order_id_counter';
  var STORAGE_OWNER_ACCOUNTS = 'mm_owner_accounts';
  var STORAGE_PAYMENT_METHODS = 'mm_payment_methods';
  var STORAGE_PAYOUT_METHODS = 'mm_payout_methods';

  // Helper: Get JSON from localStorage
  function getStorage(key, defaultValue) {
    try {
      var val = localStorage.getItem(key);
      return val ? JSON.parse(val) : (defaultValue || null);
    } catch(e) {
      return defaultValue || null;
    }
  }

  // Helper: Set JSON in localStorage
  function setStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch(e) {
      return false;
    }
  }

  // Get current logged-in user
  function getCurrentUser() {
    return getStorage(STORAGE_CURRENT_USER);
  }

  // Set current user
  function setCurrentUser(user) {
    if (user) {
      setStorage(STORAGE_CURRENT_USER, user);
    } else {
      localStorage.removeItem(STORAGE_CURRENT_USER);
    }
  }

  // Get all users
  function getAllUsers() {
    return getStorage(STORAGE_USERS, []);
  }

  // Save user to users list
  function saveUser(user) {
    var users = getAllUsers();
    var existing = users.findIndex(function(u) { return u.id === user.id; });
    if (existing >= 0) {
      users[existing] = user;
    } else {
      users.push(user);
    }
    setStorage(STORAGE_USERS, users);
  }

  // Find user by email
  function findUserByEmail(email) {
    var users = getAllUsers();
    return users.find(function(u) { return u.email === email; });
  }

  // Find user by ID
  function findUserById(userId) {
    var users = getAllUsers();
    return users.find(function(u) { return u.id === userId; });
  }

  // Generate unique ID
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Convert file to base64 data URL
  function fileToBase64(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Get restaurants
  function getRestaurants() {
    return getStorage(STORAGE_RESTAURANTS, []);
  }

  // Save restaurant
  function saveRestaurant(restaurant) {
    var restaurants = getRestaurants();
    if (!restaurant.id) restaurant.id = generateId();
    var existing = restaurants.findIndex(function(r) { return r.id === restaurant.id; });
    if (existing >= 0) {
      restaurants[existing] = restaurant;
    } else {
      restaurants.push(restaurant);
    }
    setStorage(STORAGE_RESTAURANTS, restaurants);
    return restaurant;
  }

  // Get menu items for a restaurant
  function getMenuItems(restaurantId) {
    var allItems = getStorage(STORAGE_MENU_ITEMS, []);
    return allItems.filter(function(item) { return item.restaurant_id === restaurantId; });
  }

  // Save menu item
  function saveMenuItem(item) {
    var allItems = getStorage(STORAGE_MENU_ITEMS, []);
    if (!item.id) item.id = generateId();
    var existing = allItems.findIndex(function(i) { return i.id === item.id; });
    if (existing >= 0) {
      allItems[existing] = item;
    } else {
      allItems.push(item);
    }
    setStorage(STORAGE_MENU_ITEMS, allItems);
    return item;
  }

  // Get orders for current user
  function getUserOrders() {
    var user = getCurrentUser();
    if (!user) return [];
    var allOrders = getStorage(STORAGE_ORDERS, []);
    return allOrders.filter(function(o) { return o.user_id === user.id; }).sort(function(a, b) {
      return (b.created_at || 0) - (a.created_at || 0);
    });
  }

  // Create order
  function createOrder(items, address, estimatedTime, totalSavings, paymentMethodId) {
    var user = getCurrentUser();
    if (!user) return null;
    var orderId = getStorage(STORAGE_ORDER_ID_COUNTER, 0) + 1;
    setStorage(STORAGE_ORDER_ID_COUNTER, orderId);
    
    // Calculate total payment amount and credit to restaurant owners
    var totalAmount = 0;
    var ownerPayments = {}; // Track payments per owner: {owner_id: amount}
    var allMenuItems = getStorage(STORAGE_MENU_ITEMS, []);
    var allRestaurants = getStorage(STORAGE_RESTAURANTS, []);
    
    items.forEach(function(item) {
      var itemTotal = (item.price || 0) * (item.quantity || 1);
      totalAmount += itemTotal;
      
      // Find which restaurant this item belongs to
      // First try to find by menu_item_id, then by restaurant_id if available
      var menuItem = allMenuItems.find(function(mi) { return String(mi.id) === String(item.menu_item_id); });
      var restaurant = null;
      
      if (menuItem) {
        restaurant = allRestaurants.find(function(r) { return String(r.id) === String(menuItem.restaurant_id); });
      } else if (item.restaurant_id) {
        // If menu item not found, try to find restaurant directly from order item
        restaurant = allRestaurants.find(function(r) { return String(r.id) === String(item.restaurant_id); });
      }
      
      if (restaurant && restaurant.owner_id) {
        // Credit payment to restaurant owner
        if (!ownerPayments[restaurant.owner_id]) {
          ownerPayments[restaurant.owner_id] = 0;
        }
        ownerPayments[restaurant.owner_id] += itemTotal;
      }
    });
    
    // Credit payments to owner accounts
    var ownerAccounts = getStorage(STORAGE_OWNER_ACCOUNTS, {});
    for (var ownerId in ownerPayments) {
      if (!ownerAccounts[ownerId]) {
        ownerAccounts[ownerId] = { balance: 0, transactions: [] };
      }
      var paymentAmount = ownerPayments[ownerId];
      ownerAccounts[ownerId].balance = (ownerAccounts[ownerId].balance || 0) + paymentAmount;
      ownerAccounts[ownerId].transactions = ownerAccounts[ownerId].transactions || [];
      ownerAccounts[ownerId].transactions.push({
        order_id: orderId,
        amount: paymentAmount,
        date: Date.now(),
        type: 'payment_received'
      });
    }
    setStorage(STORAGE_OWNER_ACCOUNTS, ownerAccounts);
    
    var order = {
      id: orderId,
      user_id: user.id,
      status: 'pending',
      created_at: Date.now(),
      items: items,
      address: address || '',
      estimated_delivery_time: estimatedTime || null,
      delivery_time: estimatedTime ? Date.now() + (estimatedTime * 60000) : null,
      total_savings: totalSavings || 0,
      total_amount: totalAmount,
      owner_payments: ownerPayments,
      payment_method_id: paymentMethodId || null
    };
    var allOrders = getStorage(STORAGE_ORDERS, []);
    allOrders.push(order);
    setStorage(STORAGE_ORDERS, allOrders);
    return order;
  }
  
  // Get owner account balance
  function getOwnerAccountBalance(ownerId) {
    var ownerAccounts = getStorage(STORAGE_OWNER_ACCOUNTS, {});
    return ownerAccounts[ownerId] ? (ownerAccounts[ownerId].balance || 0) : 0;
  }
  
  // Get owner account transactions
  function getOwnerAccountTransactions(ownerId) {
    var ownerAccounts = getStorage(STORAGE_OWNER_ACCOUNTS, {});
    return ownerAccounts[ownerId] ? (ownerAccounts[ownerId].transactions || []) : [];
  }

  // Get payout methods for owner
  function getPayoutMethods(ownerId) {
    var allMethods = getStorage(STORAGE_PAYOUT_METHODS, {});
    return allMethods[ownerId] || [];
  }

  // Save payout methods for owner
  function savePayoutMethods(ownerId, methods) {
    var allMethods = getStorage(STORAGE_PAYOUT_METHODS, {});
    allMethods[ownerId] = methods;
    return setStorage(STORAGE_PAYOUT_METHODS, allMethods);
  }

  // Get default payout method
  function getDefaultPayoutMethod(ownerId) {
    var methods = getPayoutMethods(ownerId);
    return methods.find(function(m) { return m.is_default; }) || methods[0] || null;
  }

  // Show payout methods management modal
  function showPayoutMethods() {
    var user = getCurrentUser();
    if (!user || user.role !== 'owner') return;

    var methods = getPayoutMethods(user.id);
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1002;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:30px;border-radius:12px;max-width:600px;width:90%;max-height:90vh;overflow-y:auto;';

    function formatAccountNumber(accountNumber) {
      if (!accountNumber) return '';
      if (accountNumber.length <= 4) return accountNumber;
      return '****' + accountNumber.slice(-4);
    }

    function renderMethods() {
      var methodsHtml = methods.length > 0 ? methods.map(function(method, index) {
        var defaultBadge = method.is_default ? '<span style="background:#4caf50;color:white;padding:4px 8px;border-radius:4px;font-size:11px;margin-left:8px;">Default</span>' : '';
        return '<div class="payout-method-item" data-index="' + index + '" style="display:flex;justify-content:space-between;align-items:center;padding:15px;margin-bottom:10px;background:#f9f9f9;border:2px solid ' + (method.is_default ? '#4caf50' : '#ddd') + ';border-radius:8px;">' +
          '<div style="flex:1;">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px;">' +
          '<span style="font-size:24px;">🏦</span>' +
          '<div>' +
          '<div style="font-weight:600;color:#333;font-size:16px;">' + (method.bank_name || 'Bank Account') + defaultBadge + '</div>' +
          '<div style="font-size:14px;color:#666;margin-top:2px;">Account: ' + formatAccountNumber(method.account_number) + '</div>' +
          '<div style="font-size:12px;color:#999;margin-top:2px;">Account Holder: ' + (method.account_holder_name || 'N/A') + '</div>' +
          (method.branch_name ? '<div style="font-size:12px;color:#999;margin-top:2px;">Branch: ' + method.branch_name + '</div>' : '') +
          '</div>' +
          '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;">' +
          (!method.is_default ? '<button class="set-default-payout" data-index="' + index + '" style="padding:6px 12px;border:1px solid #4caf50;border-radius:6px;background:#fff;color:#4caf50;cursor:pointer;font-size:12px;">Set Default</button>' : '') +
          '<button class="edit-payout" data-index="' + index + '" style="padding:6px 12px;border:1px solid #ff6f61;border-radius:6px;background:#fff;color:#ff6f61;cursor:pointer;font-size:12px;">Edit</button>' +
          '<button class="delete-payout" data-index="' + index + '" style="padding:6px 12px;border:1px solid #f44336;border-radius:6px;background:#fff;color:#f44336;cursor:pointer;font-size:12px;">Delete</button>' +
          '</div>' +
          '</div>';
      }).join('') : '<div style="text-align:center;padding:40px;color:#999;"><p style="margin-bottom:10px;">No bank accounts added yet.</p><p style="font-size:14px;">Add a bank account to withdraw your earnings!</p></div>';

      return methodsHtml;
    }

    box.innerHTML = '<h2 style="color:#ff6f61;margin-bottom:20px;text-align:center;">🏦 Payout Methods</h2>' +
      '<div id="payout-methods-list" style="margin-bottom:20px;max-height:400px;overflow-y:auto;">' + renderMethods() + '</div>' +
      '<div style="text-align:center;padding:20px;background:#f9f9f9;border-radius:8px;margin-bottom:20px;">' +
      '<button id="add-payout-method" style="padding:12px 24px;border:2px dashed #ff6f61;border-radius:8px;background:#fff;color:#ff6f61;cursor:pointer;font-weight:600;font-size:16px;width:100%;">+ Add Bank Account</button>' +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:center;">' +
      '<button id="close-payout-methods" style="padding:12px 24px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;font-weight:600;">Close</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    function attachPayoutMethodListeners() {
      box.querySelectorAll('.set-default-payout').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var index = parseInt(btn.getAttribute('data-index'));
          methods.forEach(function(m, i) {
            m.is_default = (i === index);
          });
          savePayoutMethods(user.id, methods);
          box.querySelector('#payout-methods-list').innerHTML = renderMethods();
          attachPayoutMethodListeners();
        });
      });

      box.querySelectorAll('.edit-payout').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var index = parseInt(btn.getAttribute('data-index'));
          document.body.removeChild(modal);
          showAddEditPayoutMethod(methods[index], index);
        });
      });

      box.querySelectorAll('.delete-payout').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var index = parseInt(btn.getAttribute('data-index'));
          if (confirm('Are you sure you want to delete this bank account?')) {
            methods.splice(index, 1);
            savePayoutMethods(user.id, methods);
            box.querySelector('#payout-methods-list').innerHTML = renderMethods();
            attachPayoutMethodListeners();
          }
        });
      });
    }

    // Add payout method
    box.querySelector('#add-payout-method').addEventListener('click', function() {
      document.body.removeChild(modal);
      showAddEditPayoutMethod();
    });

    attachPayoutMethodListeners();

    box.querySelector('#close-payout-methods').addEventListener('click', function() {
      document.body.removeChild(modal);
    });
  }

  // Show add/edit payout method modal
  function showAddEditPayoutMethod(method, index) {
    var user = getCurrentUser();
    if (!user || user.role !== 'owner') return;
    
    var isEdit = method !== undefined;
    var methods = getPayoutMethods(user.id);
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1003;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:30px;border-radius:12px;max-width:500px;width:90%;max-height:90vh;overflow-y:auto;';

    box.innerHTML = '<h3 style="color:#ff6f61;margin-bottom:20px;">' + (isEdit ? 'Edit' : 'Add') + ' Bank Account</h3>' +
      '<div style="margin-bottom:15px;">' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Bank Name <span style="color:#f44336;">*</span></label>' +
      '<input id="payout-bank-name" type="text" placeholder="e.g., Bank of Japan, Mizuho Bank" value="' + (method ? (method.bank_name || '') : '') + '" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '</div>' +
      '<div style="margin-bottom:15px;">' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Branch Name (optional)</label>' +
      '<input id="payout-branch-name" type="text" placeholder="e.g., Shibuya Branch" value="' + (method ? (method.branch_name || '') : '') + '" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '</div>' +
      '<div style="margin-bottom:15px;">' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Account Type <span style="color:#f44336;">*</span></label>' +
      '<select id="payout-account-type" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '<option value="savings"' + (method && method.account_type === 'savings' ? ' selected' : '') + '>Savings Account</option>' +
      '<option value="checking"' + (method && method.account_type === 'checking' ? ' selected' : '') + '>Checking Account</option>' +
      '</select>' +
      '</div>' +
      '<div style="margin-bottom:15px;">' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Account Number <span style="color:#f44336;">*</span></label>' +
      '<input id="payout-account-number" type="text" placeholder="Enter account number" value="' + (method ? (method.account_number || '') : '') + '" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '</div>' +
      '<div style="margin-bottom:15px;">' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Account Holder Name <span style="color:#f44336;">*</span></label>' +
      '<input id="payout-account-holder" type="text" placeholder="Full name as on bank account" value="' + (method ? (method.account_holder_name || '') : '') + '" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '</div>' +
      '<div style="margin-bottom:20px;">' +
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
      '<input type="checkbox" id="payout-is-default"' + (method && method.is_default ? ' checked' : (methods.length === 0 ? ' checked' : '')) + ' style="width:18px;height:18px;">' +
      '<span style="font-weight:600;color:#333;">Set as default payout method</span>' +
      '</label>' +
      '</div>' +
      '<div id="payout-error" style="color:#f44336;margin-bottom:15px;min-height:20px;font-size:14px;"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button id="cancel-payout" style="padding:12px 24px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;cursor:pointer;font-weight:600;">Cancel</button>' +
      '<button id="save-payout" style="padding:12px 24px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;font-weight:600;">' + (isEdit ? 'Update' : 'Add') + ' Bank Account</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    box.querySelector('#cancel-payout').addEventListener('click', function() {
      document.body.removeChild(modal);
      if (!isEdit) {
        showPayoutMethods();
      }
    });

    box.querySelector('#save-payout').addEventListener('click', function() {
      var bankName = box.querySelector('#payout-bank-name').value.trim();
      var branchName = box.querySelector('#payout-branch-name').value.trim();
      var accountType = box.querySelector('#payout-account-type').value;
      var accountNumber = box.querySelector('#payout-account-number').value.trim();
      var accountHolder = box.querySelector('#payout-account-holder').value.trim();
      var isDefault = box.querySelector('#payout-is-default').checked;
      var errorEl = box.querySelector('#payout-error');

      errorEl.textContent = '';

      if (!bankName) {
        errorEl.textContent = 'Please enter bank name.';
        return;
      }
      if (!accountNumber || accountNumber.length < 4) {
        errorEl.textContent = 'Please enter a valid account number.';
        return;
      }
      if (!accountHolder) {
        errorEl.textContent = 'Please enter account holder name.';
        return;
      }

      var payoutMethod = {
        id: method ? method.id : generateId(),
        bank_name: bankName,
        branch_name: branchName || null,
        account_type: accountType,
        account_number: accountNumber,
        account_holder_name: accountHolder,
        is_default: isDefault
      };

      if (isDefault) {
        methods.forEach(function(m) {
          m.is_default = false;
        });
      }

      if (isEdit && index !== undefined) {
        methods[index] = payoutMethod;
      } else {
        methods.push(payoutMethod);
      }

      savePayoutMethods(user.id, methods);
      document.body.removeChild(modal);
      showPayoutMethods();
    });
  }

  // Calculate estimated delivery time (in minutes)
  function calculateEstimatedTime(address) {
    // Simple estimation: base time + distance factor
    // In a real app, this would use geocoding and distance calculation
    // Maximum delivery time is capped at 20 minutes
    var baseTime = 10; // Base 10 minutes
    var distanceFactor = address ? Math.floor(Math.random() * 10) + 5 : 5; // Random 5-15 minutes
    var totalTime = baseTime + distanceFactor;
    return Math.min(totalTime, 20); // Cap at 20 minutes maximum
  }

  // Show order confirmation with tracking map
  function showOrderConfirmation(order) {
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1002;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:25px;border-radius:12px;max-width:700px;width:90%;max-height:90vh;overflow-y:auto;';

    var estimatedTime = order.estimated_delivery_time || 20;
    var deliveryTime = order.delivery_time ? new Date(order.delivery_time) : new Date(Date.now() + estimatedTime * 60000);

    var totalSavings = order.total_savings || 0;
    var savingsDisplay = totalSavings > 0 ? '<div style="background:#e8f5e9;padding:12px;border-radius:8px;margin-bottom:15px;border:2px solid #4caf50;"><p style="margin:0;font-size:18px;font-weight:700;color:#2e7d32;text-align:center;">💰 You Saved: ¥' + totalSavings.toFixed(0) + '!</p></div>' : '';
    
    box.innerHTML = '<h2 style="color:#ff6f61;margin-bottom:20px;text-align:center;">✅ Order Placed Successfully!</h2>' +
      savingsDisplay +
      '<div style="background:#e8f5e9;padding:15px;border-radius:8px;margin-bottom:20px;">' +
      '<p style="margin:0;font-size:16px;font-weight:600;color:#2e7d32;"><strong>Order #' + order.id + '</strong></p>' +
      '<p style="margin:8px 0 0 0;color:#555;">Estimated delivery time: <strong>' + estimatedTime + ' minutes</strong></p>' +
      '<p style="margin:4px 0 0 0;color:#555;">Expected delivery by: <strong>' + deliveryTime.toLocaleTimeString() + '</strong></p>' +
      '</div>' +
      '<div style="margin-bottom:20px;">' +
      '<p style="margin:0 0 8px 0;font-weight:600;color:#333;">📍 Delivery Address:</p>' +
      '<p style="margin:0;padding:10px;background:#f5f5f5;border-radius:6px;color:#555;">' + (order.address || 'No address provided') + '</p>' +
      '</div>' +
      '<div style="margin-bottom:20px;">' +
      '<p style="margin:0 0 8px 0;font-weight:600;color:#333;">🗺️ Track Your Order:</p>' +
      '<div id="orderTrackingMap" style="width:100%;height:300px;border:2px solid #ddd;border-radius:8px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">' +
      '<div style="text-align:center;color:#666;">' +
      '<div style="font-size:48px;margin-bottom:10px;">📍</div>' +
      '<p style="margin:0;font-size:14px;">Map tracking will be available here</p>' +
      '<p style="margin:5px 0 0 0;font-size:12px;color:#999;">(In production, this would show real-time delivery tracking)</p>' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:center;margin-top:20px;">' +
      '<button id="orderConfirmClose" style="padding:12px 24px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;font-weight:600;">Close</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    // Initialize map (using a simple placeholder - in production, use Google Maps or similar)
    initOrderTrackingMap(box.querySelector('#orderTrackingMap'), order);

    box.querySelector('#orderConfirmClose').onclick = function() {
      document.body.removeChild(modal);
    };
  }

  // Initialize order tracking map
  function initOrderTrackingMap(mapContainer, order) {
    // This is a placeholder for map functionality
    // In production, you would integrate with Google Maps API or similar
    // For now, we'll create a visual representation
    
    // Create a simple visual tracking display
    var trackingHtml = '<div style="width:100%;height:100%;position:relative;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;">' +
      '<div style="text-align:center;padding:20px;">' +
      '<div style="font-size:64px;margin-bottom:15px;">🚚</div>' +
      '<p style="margin:0 0 10px 0;font-size:18px;font-weight:600;">Order #' + order.id + ' is on the way!</p>' +
      '<p style="margin:0;font-size:14px;opacity:0.9;">Estimated arrival: ' + (order.estimated_delivery_time || 20) + ' minutes</p>' +
      '<div style="margin-top:20px;padding:10px;background:rgba(255,255,255,0.2);border-radius:6px;">' +
      '<p style="margin:0;font-size:12px;">📍 ' + (order.address || 'Address not provided') + '</p>' +
      '</div>' +
      '</div>' +
      '<div style="position:absolute;bottom:10px;left:10px;right:10px;display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(0,0,0,0.3);border-radius:6px;">' +
      '<span style="font-size:12px;">🟢 Order Confirmed</span>' +
      '<span style="font-size:12px;">⏱️ ' + (order.estimated_delivery_time || 20) + ' min</span>' +
      '</div>' +
      '</div>';
    
    mapContainer.innerHTML = trackingHtml;
  }

  // Show order tracking modal
  function showOrderTracking(order) {
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1002;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:25px;border-radius:12px;max-width:700px;width:90%;max-height:90vh;overflow-y:auto;';

    var estimatedTime = order.estimated_delivery_time || 20;
    var deliveryTime = order.delivery_time ? new Date(order.delivery_time) : new Date(Date.now() + estimatedTime * 60000);
    var timeRemaining = order.delivery_time ? Math.max(0, Math.floor((order.delivery_time - Date.now()) / 60000)) : estimatedTime;

    box.innerHTML = '<h2 style="color:#ff6f61;margin-bottom:20px;text-align:center;">🗺️ Track Order #' + order.id + '</h2>' +
      '<div style="background:#e3f2fd;padding:15px;border-radius:8px;margin-bottom:20px;">' +
      '<p style="margin:0;font-size:16px;font-weight:600;color:#1976d2;"><strong>Status: ' + (order.status || 'pending').toUpperCase() + '</strong></p>' +
      '<p style="margin:8px 0 0 0;color:#555;">⏱️ Estimated delivery time: <strong>' + estimatedTime + ' minutes</strong></p>' +
      '<p style="margin:4px 0 0 0;color:#555;">🕐 Expected delivery by: <strong>' + deliveryTime.toLocaleTimeString() + '</strong></p>' +
      (timeRemaining > 0 ? '<p style="margin:4px 0 0 0;color:#555;">⏳ Time remaining: <strong>' + timeRemaining + ' minutes</strong></p>' : '<p style="margin:4px 0 0 0;color:#4caf50;">✅ Order should arrive soon!</p>') +
      '</div>' +
      '<div style="margin-bottom:20px;">' +
      '<p style="margin:0 0 8px 0;font-weight:600;color:#333;">📍 Delivery Address:</p>' +
      '<p style="margin:0;padding:10px;background:#f5f5f5;border-radius:6px;color:#555;">' + (order.address || 'No address provided') + '</p>' +
      '</div>' +
      '<div style="margin-bottom:20px;">' +
      '<p style="margin:0 0 8px 0;font-weight:600;color:#333;">🗺️ Live Tracking:</p>' +
      '<div id="orderTrackingMapView" style="width:100%;height:350px;border:2px solid #ddd;border-radius:8px;background:#f0f0f0;position:relative;overflow:hidden;">' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:center;margin-top:20px;">' +
      '<button id="orderTrackingClose" style="padding:12px 24px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;font-weight:600;">Close</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    // Initialize tracking map
    initOrderTrackingMap(box.querySelector('#orderTrackingMapView'), order);

    box.querySelector('#orderTrackingClose').onclick = function() {
      document.body.removeChild(modal);
    };
  }

  // Build user menu dropdown
  function buildUserMenu(name, photoUrl, orderStatusText) {
    var wrapper = document.createElement('div');
    wrapper.className = 'user-menu';

    var button = document.createElement('button');
    button.className = 'user-menu-button';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    if (photoUrl) {
      var img = document.createElement('img');
      img.src = photoUrl;
      img.alt = name;
      img.style.width = '28px';
      img.style.height = '28px';
      img.style.borderRadius = '50%';
      img.style.marginRight = '8px';
      img.style.verticalAlign = 'middle';
      img.style.objectFit = 'cover';
      button.appendChild(img);
    }
    var label = document.createElement('span');
    label.textContent = name;
    button.appendChild(label);

    var list = document.createElement('ul');
    list.className = 'user-menu-dropdown';

    if (orderStatusText) {
      var itemStatus = document.createElement('li');
      var statusBtn = document.createElement('button');
      statusBtn.className = 'user-menu-logout';
      statusBtn.textContent = 'Order status: ' + orderStatusText;
      statusBtn.disabled = true;
      statusBtn.style.fontSize = '0.9em';
      itemStatus.appendChild(statusBtn);
      list.appendChild(itemStatus);
    }

    var itemProfile = document.createElement('li');
    var btnProfile = document.createElement('button');
    btnProfile.className = 'user-menu-logout';
    btnProfile.textContent = 'Edit Profile';
    btnProfile.addEventListener('click', function(e) {
      e.preventDefault();
      showProfileEdit();
    });
    itemProfile.appendChild(btnProfile);
    list.appendChild(itemProfile);

    var itemOrderHistory = document.createElement('li');
    var btnOrderHistory = document.createElement('button');
    btnOrderHistory.className = 'user-menu-logout';
    btnOrderHistory.textContent = 'Order History';
    btnOrderHistory.addEventListener('click', function(e) {
      e.preventDefault();
      showOrderHistory();
    });
    itemOrderHistory.appendChild(btnOrderHistory);
    list.appendChild(itemOrderHistory);

    // Add Payment Methods option for customers
    var user = getCurrentUser();
    if (user && user.role === 'customer') {
      var itemPaymentMethods = document.createElement('li');
      var btnPaymentMethods = document.createElement('button');
      btnPaymentMethods.className = 'user-menu-logout';
      btnPaymentMethods.textContent = '💳 Payment Methods';
      btnPaymentMethods.addEventListener('click', function(e) {
        e.preventDefault();
        showPaymentMethods();
      });
      itemPaymentMethods.appendChild(btnPaymentMethods);
      list.appendChild(itemPaymentMethods);
    }

    var itemLogout = document.createElement('li');
    var btnLogout = document.createElement('button');
    btnLogout.className = 'user-menu-logout';
    btnLogout.textContent = 'Logout';
    btnLogout.addEventListener('click', function(e) {
      e.preventDefault();
      setCurrentUser(null);
      var target = (location.pathname.toLowerCase().endsWith('login.html')) ? location.href : 'index.html';
      window.location.href = target;
    });
    itemLogout.appendChild(btnLogout);
    list.appendChild(itemLogout);

    button.addEventListener('click', function(e) {
      e.stopPropagation();
    var isOpen = list.classList.contains('open');
    list.classList.toggle('open');
    // Ensure visibility even without CSS
    list.style.display = isOpen ? 'none' : 'block';
    button.setAttribute('aria-expanded', String(!isOpen));
    });

    document.addEventListener('click', function(e) {
      if (!wrapper.contains(e.target)) {
        list.classList.remove('open');
        list.style.display = 'none';
        button.setAttribute('aria-expanded', 'false');
      }
    });

    wrapper.appendChild(button);
    wrapper.appendChild(list);
    return wrapper;
  }

  // Show profile edit modal
  function showProfileEdit() {
    var user = getCurrentUser();
    if (!user) return;

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:white;padding:30px;border-radius:12px;max-width:400px;width:90%;max-height:90vh;overflow-y:auto;';
    
    box.innerHTML = '<h2 style="color:#ff6f61;margin-bottom:20px;">Edit Profile</h2>' +
      '<div style="margin-bottom:15px;"><label>Name:</label><input type="text" id="profile-name" value="' + (user.name || '') + '" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc;margin-top:5px;"></div>' +
      '<div style="margin-bottom:15px;"><label>Email:</label><input type="email" id="profile-email" value="' + (user.email || '') + '" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc;margin-top:5px;"></div>' +
      '<div style="margin-bottom:15px;"><label>Password (leave blank to keep current):</label><input type="password" id="profile-password" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc;margin-top:5px;"></div>' +
      '<div style="margin-bottom:15px;"><label>Photo:</label><input type="file" id="profile-photo" accept="image/*" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc;margin-top:5px;"></div>' +
      '<div id="profile-error" style="color:#b00020;min-height:1.2em;margin-bottom:10px;"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button id="profile-cancel" style="padding:10px 20px;border-radius:6px;border:1px solid #ccc;background:white;cursor:pointer;">Cancel</button>' +
      '<button id="profile-save" style="padding:10px 20px;border-radius:6px;border:none;background:#ff6f61;color:white;cursor:pointer;">Save</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    document.getElementById('profile-cancel').addEventListener('click', function() {
      document.body.removeChild(modal);
    });

    document.getElementById('profile-save').addEventListener('click', function() {
      var name = document.getElementById('profile-name').value.trim();
      var email = document.getElementById('profile-email').value.trim();
      var password = document.getElementById('profile-password').value;
      var photoFile = document.getElementById('profile-photo').files[0];
      var errorEl = document.getElementById('profile-error');
      errorEl.textContent = '';

      if (!name || !email) {
        errorEl.textContent = 'Name and email are required.';
        return;
      }

      var updated = Object.assign({}, user);
      updated.name = name;
      updated.email = email;
      if (password) {
        if (password.length < 6) {
          errorEl.textContent = 'Password must be at least 6 characters.';
          return;
        }
        updated.password = password; // Store plain for demo (in real app, hash it)
      }

      if (photoFile) {
        fileToBase64(photoFile).then(function(base64) {
          updated.photo_url = base64;
          saveUser(updated);
          setCurrentUser(updated);
          document.body.removeChild(modal);
          location.reload();
        }).catch(function(err) {
          errorEl.textContent = 'Error uploading photo.';
        });
      } else {
        saveUser(updated);
        setCurrentUser(updated);
        document.body.removeChild(modal);
        location.reload();
      }
    });
  }

  // Show orders and savings page for customers
  function showOrdersAndSavings() {
    var user = getCurrentUser();
    if (!user || user.role === 'owner') return;

    var orders = getUserOrders();
    var pendingOrders = orders.filter(function(o) { return o.status === 'pending' || o.status === 'confirmed'; });
    
    // Calculate lifetime savings from all orders
    // If total_savings is not set, calculate from items
    var totalSavings = orders.reduce(function(sum, order) {
      if (order.total_savings !== undefined && order.total_savings !== null) {
        return sum + order.total_savings;
      }
      // Calculate savings from items if total_savings is not set
      if (order.items && order.items.length > 0) {
        var orderSavings = order.items.reduce(function(itemSum, item) {
          var itemSavings = item.savings || ((item.old_price && item.old_price > item.price) ? (item.old_price - item.price) * (item.quantity || 1) : 0);
          return itemSum + itemSavings;
        }, 0);
        // Update order with calculated savings if missing
        if (orderSavings > 0) {
          var allOrders = getStorage(STORAGE_ORDERS, []);
          var orderIndex = allOrders.findIndex(function(o) { return o.id === order.id; });
          if (orderIndex >= 0) {
            allOrders[orderIndex].total_savings = orderSavings;
            setStorage(STORAGE_ORDERS, allOrders);
          }
        }
        return sum + orderSavings;
      }
      return sum;
    }, 0);
    var lifetimeSavings = totalSavings;

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1003;display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:20px;';
    
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:30px;border-radius:12px;max-width:800px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.2);';

    function formatDate(timestamp) {
      if (!timestamp) return 'N/A';
      var date = new Date(timestamp);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    function getStatusColor(status) {
      var colors = {
        'pending': '#ff9800',
        'confirmed': '#2196f3',
        'delivered': '#4caf50',
        'cancelled': '#f44336'
      };
      return colors[status] || '#666';
    }

    // Calculate current orders total and savings
    var currentOrdersTotal = 0;
    var currentOrdersSavings = 0;
    pendingOrders.forEach(function(order) {
      if (order.items && order.items.length > 0) {
        order.items.forEach(function(item) {
          currentOrdersTotal += (item.price || 0) * (item.quantity || 1);
        });
      }
      // Use total_savings if available, otherwise calculate from items
      if (order.total_savings !== undefined && order.total_savings !== null) {
        currentOrdersSavings += order.total_savings;
      } else if (order.items && order.items.length > 0) {
        var orderSavings = order.items.reduce(function(itemSum, item) {
          var itemSavings = item.savings || ((item.old_price && item.old_price > item.price) ? (item.old_price - item.price) * (item.quantity || 1) : 0);
          return itemSum + itemSavings;
        }, 0);
        currentOrdersSavings += orderSavings;
        // Update order with calculated savings if missing
        if (orderSavings > 0) {
          var allOrders = getStorage(STORAGE_ORDERS, []);
          var orderIndex = allOrders.findIndex(function(o) { return o.id === order.id; });
          if (orderIndex >= 0) {
            allOrders[orderIndex].total_savings = orderSavings;
            setStorage(STORAGE_ORDERS, allOrders);
          }
        }
      }
    });

    var currentOrdersHtml = '';
    if (pendingOrders.length === 0) {
      currentOrdersHtml = '<div style="text-align:center;padding:40px;color:#999;"><p style="font-size:18px;margin-bottom:10px;">No current orders</p><p>Browse restaurants and place your first order!</p></div>';
    } else {
      pendingOrders.forEach(function(order) {
        var total = 0;
        var itemsHtml = '';
        if (order.items && order.items.length > 0) {
          order.items.forEach(function(item) {
            var itemTotal = (item.price || 0) * (item.quantity || 1);
            total += itemTotal;
            var itemSavings = item.savings || ((item.old_price && item.old_price > item.price) ? (item.old_price - item.price) * (item.quantity || 1) : 0);
            var itemOriginalTotal = item.old_price ? item.old_price * (item.quantity || 1) : itemTotal;
            var savingsHtml = itemSavings > 0 ? '<div style="font-size:11px;color:#4caf50;margin-top:2px;">💚 Saved: ¥' + itemSavings.toFixed(0) + '</div>' : '';
            var priceDisplay = itemSavings > 0 ? '<div style="text-align:right;"><span style="text-decoration:line-through;color:#999;font-size:11px;">¥' + itemOriginalTotal.toFixed(0) + '</span><br><span style="color:#ff6f61;font-weight:600;">¥' + itemTotal.toFixed(0) + '</span></div>' : '<span>¥' + itemTotal.toFixed(0) + '</span>';
            itemsHtml += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px;">' +
              '<div><span>' + (item.name || 'Item') + ' x' + (item.quantity || 1) + '</span>' + savingsHtml + '</div>' +
              '<div>' + priceDisplay + '</div>' +
              '</div>';
          });
        }
        var orderSavings = order.total_savings || 0;
        var estimatedTimeHtml = order.estimated_delivery_time ? '<div style="margin:8px 0;padding:6px;background:#e3f2fd;border-radius:4px;"><small style="color:#1976d2;">⏱️ Estimated: ' + order.estimated_delivery_time + ' minutes</small></div>' : '';
        var addressHtml = order.address ? '<div style="margin:8px 0;padding:6px;background:#f5f5f5;border-radius:4px;"><small style="color:#666;">📍 ' + order.address + '</small></div>' : '';
        var savingsHtml = orderSavings > 0 ? '<div style="margin:8px 0;padding:8px;background:#e8f5e9;border-radius:4px;border:1px solid #4caf50;"><small style="color:#2e7d32;font-weight:600;">💰 Savings: ¥' + orderSavings.toFixed(0) + '</small></div>' : '';
        currentOrdersHtml += '<div style="border:2px solid #eee;border-radius:8px;padding:15px;margin-bottom:15px;background:#fafafa;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:2px solid #eee;">' +
          '<div><strong style="color:#ff6f61;font-size:16px;">Order #' + order.id + '</strong><br><small style="color:#666;">' + formatDate(order.created_at) + '</small></div>' +
          '<span style="padding:6px 12px;border-radius:6px;background:' + getStatusColor(order.status) + ';color:white;font-size:12px;font-weight:600;">' + (order.status || 'pending').toUpperCase() + '</span>' +
          '</div>' +
          addressHtml +
          estimatedTimeHtml +
          '<div style="margin:10px 0;">' + itemsHtml + '</div>' +
          savingsHtml +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:2px solid #eee;margin-top:10px;">' +
          '<strong style="font-size:16px;color:#ff6f61;">Total: ¥' + total.toFixed(2) + '</strong>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="edit-order-btn" data-order-id="' + order.id + '" style="padding:6px 12px;border-radius:6px;border:none;background:#ff6f61;color:white;cursor:pointer;font-size:12px;">Edit</button>' +
          '<button class="track-order-btn" data-order-id="' + order.id + '" style="padding:6px 12px;border-radius:6px;border:none;background:#2196f3;color:white;cursor:pointer;font-size:12px;">Track</button>' +
          '<button class="delete-order-btn" data-order-id="' + order.id + '" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:12px;">Delete</button>' +
          '</div>' +
          '</div>' +
          '</div>';
      });
    }

    box.innerHTML = '<div style="text-align:center;margin-bottom:30px;">' +
      '<h2 style="color:#ff6f61;margin-bottom:10px;font-size:28px;">My Orders & Savings</h2>' +
      '<p style="color:#666;font-size:14px;">Track your current orders and see how much you\'ve saved!</p>' +
      '</div>' +
      
      // Savings Summary
      '<div style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);padding:25px;border-radius:12px;margin-bottom:30px;color:white;box-shadow:0 4px 15px rgba(102,126,234,0.3);">' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:20px;text-align:center;">' +
      '<div style="background:rgba(255,255,255,0.2);padding:20px;border-radius:8px;backdrop-filter:blur(10px);">' +
      '<div style="font-size:32px;margin-bottom:8px;">💰</div>' +
      '<div style="font-size:24px;font-weight:700;margin-bottom:5px;">¥' + lifetimeSavings.toFixed(0) + '</div>' +
      '<div style="font-size:13px;opacity:0.9;">Lifetime Savings</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.2);padding:20px;border-radius:8px;backdrop-filter:blur(10px);">' +
      '<div style="font-size:32px;margin-bottom:8px;">🛒</div>' +
      '<div style="font-size:24px;font-weight:700;margin-bottom:5px;">' + pendingOrders.length + '</div>' +
      '<div style="font-size:13px;opacity:0.9;">Current Orders</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.2);padding:20px;border-radius:8px;backdrop-filter:blur(10px);">' +
      '<div style="font-size:32px;margin-bottom:8px;">💚</div>' +
      '<div style="font-size:24px;font-weight:700;margin-bottom:5px;">¥' + currentOrdersSavings.toFixed(0) + '</div>' +
      '<div style="font-size:13px;opacity:0.9;">Savings on Current Orders</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      
      // Current Orders Section
      '<div style="margin-bottom:20px;">' +
      '<h3 style="color:#333;margin-bottom:15px;font-size:20px;border-bottom:2px solid #eee;padding-bottom:10px;">📦 Current Orders</h3>' +
      '<div id="current-orders-list">' + currentOrdersHtml + '</div>' +
      '</div>' +
      
      '<div style="display:flex;gap:10px;justify-content:center;margin-top:20px;">' +
      '<button id="orders-savings-close" style="padding:12px 24px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;font-weight:600;">Close</button>' +
      '<button id="orders-savings-history" style="padding:12px 24px;border:2px solid #ff6f61;border-radius:8px;background:transparent;color:#ff6f61;cursor:pointer;font-weight:600;">View Full History</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('orders-savings-close').addEventListener('click', function() {
      document.body.removeChild(modal);
    });

    document.getElementById('orders-savings-history').addEventListener('click', function() {
      document.body.removeChild(modal);
      showOrderHistory();
    });

    // Use event delegation for edit and track order buttons
    if (!box._editTrackOrderHandlerAttached) {
      box.addEventListener('click', function(e) {
        var btn = e.target;
        var btnClass = null;
        
        // Find which button was clicked
        while (btn && btn !== box) {
          if (btn.classList.contains('edit-order-btn')) {
            btnClass = 'edit';
            break;
          } else if (btn.classList.contains('track-order-btn')) {
            btnClass = 'track';
            break;
          }
          btn = btn.parentElement;
        }
        
        if (!btn || btn === box || !btnClass) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        var orderId = parseInt(btn.getAttribute('data-order-id'));
        if (isNaN(orderId)) return;
        
        if (btnClass === 'edit') {
          document.body.removeChild(modal);
          showEditOrder(orderId);
        } else if (btnClass === 'track') {
          var order = pendingOrders.find(function(o) { return o.id === orderId; });
          if (order) {
            document.body.removeChild(modal);
            showOrderTracking(order);
          }
        }
      });
      box._editTrackOrderHandlerAttached = true;
    }

    // Use event delegation for delete order buttons
    if (!box._deleteOrderHandlerAttached) {
      box.addEventListener('click', function(e) {
        var deleteBtn = e.target;
        while (deleteBtn && deleteBtn !== box && !deleteBtn.classList.contains('delete-order-btn')) {
          deleteBtn = deleteBtn.parentElement;
        }
        
        if (!deleteBtn || deleteBtn === box || !deleteBtn.classList.contains('delete-order-btn')) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        var orderId = parseInt(deleteBtn.getAttribute('data-order-id'));
        if (isNaN(orderId)) return;
        
        if (confirm('Are you sure you want to delete this order? This action cannot be undone.')) {
          var allOrders = getStorage(STORAGE_ORDERS, []);
          var orderIndex = allOrders.findIndex(function(o) { return o.id === orderId && o.user_id === user.id; });
          if (orderIndex >= 0) {
            // Remove the order completely
            allOrders.splice(orderIndex, 1);
            setStorage(STORAGE_ORDERS, allOrders);
            // Refresh the modal
            document.body.removeChild(modal);
            showOrdersAndSavings();
            // Refresh UI
            initAuthUi();
          }
        }
      });
      box._deleteOrderHandlerAttached = true;
    }
  }

  // Get payment methods for current user
  function getPaymentMethods() {
    var user = getCurrentUser();
    if (!user) return [];
    var allMethods = getStorage(STORAGE_PAYMENT_METHODS, {});
    return allMethods[user.id] || [];
  }

  // Save payment methods for current user
  function savePaymentMethods(methods) {
    var user = getCurrentUser();
    if (!user) return false;
    var allMethods = getStorage(STORAGE_PAYMENT_METHODS, {});
    allMethods[user.id] = methods;
    return setStorage(STORAGE_PAYMENT_METHODS, allMethods);
  }

  // Get default payment method
  function getDefaultPaymentMethod() {
    var methods = getPaymentMethods();
    return methods.find(function(m) { return m.is_default; }) || methods[0] || null;
  }

  // Show withdraw funds modal
  function showWithdrawFunds() {
    var user = getCurrentUser();
    if (!user || user.role !== 'owner') return;

    var accountBalance = getOwnerAccountBalance(user.id);
    var payoutMethods = getPayoutMethods(user.id);
    var defaultPayout = getDefaultPayoutMethod(user.id);

    if (accountBalance <= 0) {
      alert('You have no funds available to withdraw.');
      return;
    }

    if (!defaultPayout) {
      alert('Please add a bank account first to withdraw funds.');
      showPayoutMethods();
      return;
    }

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1003;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:30px;border-radius:12px;max-width:500px;width:90%;max-height:90vh;overflow-y:auto;';

    box.innerHTML = '<h3 style="color:#ff6f61;margin-bottom:20px;">💸 Withdraw Funds</h3>' +
      '<div style="background:#e8f5e9;padding:15px;border-radius:8px;margin-bottom:20px;border:2px solid #4caf50;">' +
      '<div style="font-size:14px;color:#2e7d32;margin-bottom:5px;font-weight:600;">Available Balance</div>' +
      '<div style="font-size:28px;font-weight:800;color:#2e7d32;">¥' + accountBalance.toFixed(0) + '</div>' +
      '</div>' +
      '<div style="margin-bottom:20px;">' +
      '<label style="display:block;margin-bottom:8px;font-weight:600;color:#333;">Withdrawal Amount <span style="color:#f44336;">*</span></label>' +
      '<input id="withdraw-amount" type="number" step="0.01" min="1" max="' + accountBalance + '" placeholder="Enter amount" value="' + accountBalance + '" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:16px;font-weight:600;">' +
      '</div>' +
      '<div style="margin-bottom:20px;padding:15px;background:#f9f9f9;border-radius:8px;border:1px solid #ddd;">' +
      '<div style="font-size:14px;color:#666;margin-bottom:8px;font-weight:600;">🏦 Payout to:</div>' +
      '<div style="font-size:16px;font-weight:600;color:#333;">' + (defaultPayout.bank_name || 'Bank Account') + '</div>' +
      '<div style="font-size:12px;color:#999;margin-top:4px;">Account: ****' + (defaultPayout.account_number ? defaultPayout.account_number.slice(-4) : '') + '</div>' +
      '<a href="#" id="change-payout-method" style="color:#ff6f61;font-size:12px;text-decoration:underline;display:block;margin-top:8px;">Change payout method</a>' +
      '</div>' +
      '<div id="withdraw-error" style="color:#f44336;margin-bottom:15px;min-height:20px;font-size:14px;"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button id="cancel-withdraw" style="padding:12px 24px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;cursor:pointer;font-weight:600;">Cancel</button>' +
      '<button id="confirm-withdraw" style="padding:12px 24px;border:none;border-radius:8px;background:#4caf50;color:#fff;cursor:pointer;font-weight:600;">Withdraw Funds</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    var amountInput = box.querySelector('#withdraw-amount');
    amountInput.addEventListener('input', function() {
      var amount = parseFloat(this.value) || 0;
      if (amount > accountBalance) {
        this.value = accountBalance;
      }
      if (amount < 0) {
        this.value = 0;
      }
    });

    box.querySelector('#change-payout-method').addEventListener('click', function(e) {
      e.preventDefault();
      document.body.removeChild(modal);
      showPayoutMethods();
    });

    box.querySelector('#cancel-withdraw').addEventListener('click', function() {
      document.body.removeChild(modal);
    });

    box.querySelector('#confirm-withdraw').addEventListener('click', function() {
      var amount = parseFloat(amountInput.value) || 0;
      var errorEl = box.querySelector('#withdraw-error');

      errorEl.textContent = '';

      if (!amount || amount <= 0) {
        errorEl.textContent = 'Please enter a valid withdrawal amount.';
        return;
      }
      if (amount > accountBalance) {
        errorEl.textContent = 'Withdrawal amount cannot exceed available balance.';
        return;
      }

      if (confirm('Withdraw ¥' + amount.toFixed(0) + ' to ' + (defaultPayout.bank_name || 'your bank account') + '?\n\nThis will process the withdrawal and update your account balance.')) {
        // Process withdrawal
        var ownerAccounts = getStorage(STORAGE_OWNER_ACCOUNTS, {});
        if (ownerAccounts[user.id]) {
          ownerAccounts[user.id].balance = (ownerAccounts[user.id].balance || 0) - amount;
          ownerAccounts[user.id].transactions = ownerAccounts[user.id].transactions || [];
          ownerAccounts[user.id].transactions.push({
            type: 'withdrawal',
            amount: amount,
            date: Date.now(),
            payout_method_id: defaultPayout.id,
            status: 'pending'
          });
          setStorage(STORAGE_OWNER_ACCOUNTS, ownerAccounts);
        }

        alert('Withdrawal request submitted successfully! ¥' + amount.toFixed(0) + ' will be transferred to your bank account within 2-3 business days.');
        document.body.removeChild(modal);
        // Reload the page to refresh the dashboard
        if (location.pathname.toLowerCase().includes('owner') || document.getElementById('owner-dashboard')) {
          location.reload();
        }
      }
    });
  }

  // Show payment methods management modal
  function showPaymentMethods() {
    var user = getCurrentUser();
    if (!user || user.role !== 'customer') return;

    var methods = getPaymentMethods();
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1002;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:30px;border-radius:12px;max-width:600px;width:90%;max-height:90vh;overflow-y:auto;';

    function formatCardNumber(cardNumber) {
      if (!cardNumber) return '';
      var cleaned = cardNumber.replace(/\s/g, '');
      if (cleaned.length <= 4) return cleaned;
      return '**** **** **** ' + cleaned.slice(-4);
    }

    function renderMethods() {
      var methodsHtml = methods.length > 0 ? methods.map(function(method, index) {
        var cardIcon = method.type === 'credit' ? '💳' : method.type === 'debit' ? '💳' : '💵';
        var defaultBadge = method.is_default ? '<span style="background:#4caf50;color:white;padding:4px 8px;border-radius:4px;font-size:11px;margin-left:8px;">Default</span>' : '';
        return '<div class="payment-method-item" data-index="' + index + '" style="display:flex;justify-content:space-between;align-items:center;padding:15px;margin-bottom:10px;background:#f9f9f9;border:2px solid ' + (method.is_default ? '#4caf50' : '#ddd') + ';border-radius:8px;">' +
          '<div style="flex:1;">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px;">' +
          '<span style="font-size:24px;">' + cardIcon + '</span>' +
          '<div>' +
          '<div style="font-weight:600;color:#333;font-size:16px;">' + (method.nickname || method.type.toUpperCase() + ' Card') + defaultBadge + '</div>' +
          '<div style="font-size:14px;color:#666;margin-top:2px;">' + formatCardNumber(method.card_number) + '</div>' +
          '<div style="font-size:12px;color:#999;margin-top:2px;">Expires: ' + (method.expiry_month || 'MM') + '/' + (method.expiry_year || 'YY') + '</div>' +
          '</div>' +
          '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;">' +
          (!method.is_default ? '<button class="set-default-payment" data-index="' + index + '" style="padding:6px 12px;border:1px solid #4caf50;border-radius:6px;background:#fff;color:#4caf50;cursor:pointer;font-size:12px;">Set Default</button>' : '') +
          '<button class="edit-payment" data-index="' + index + '" style="padding:6px 12px;border:1px solid #ff6f61;border-radius:6px;background:#fff;color:#ff6f61;cursor:pointer;font-size:12px;">Edit</button>' +
          '<button class="delete-payment" data-index="' + index + '" style="padding:6px 12px;border:1px solid #f44336;border-radius:6px;background:#fff;color:#f44336;cursor:pointer;font-size:12px;">Delete</button>' +
          '</div>' +
          '</div>';
      }).join('') : '<div style="text-align:center;padding:40px;color:#999;"><p style="margin-bottom:10px;">No payment methods added yet.</p><p style="font-size:14px;">Add a payment method to make checkout faster!</p></div>';

      return methodsHtml;
    }

    box.innerHTML = '<h2 style="color:#ff6f61;margin-bottom:20px;text-align:center;">💳 Payment Methods</h2>' +
      '<div id="payment-methods-list" style="margin-bottom:20px;max-height:400px;overflow-y:auto;">' + renderMethods() + '</div>' +
      '<div style="text-align:center;padding:20px;background:#f9f9f9;border-radius:8px;margin-bottom:20px;">' +
      '<button id="add-payment-method" style="padding:12px 24px;border:2px dashed #ff6f61;border-radius:8px;background:#fff;color:#ff6f61;cursor:pointer;font-weight:600;font-size:16px;width:100%;">+ Add Payment Method</button>' +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:center;">' +
      '<button id="close-payment-methods" style="padding:12px 24px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;font-weight:600;">Close</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    function attachPaymentMethodListeners() {
      box.querySelectorAll('.set-default-payment').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var index = parseInt(btn.getAttribute('data-index'));
          methods.forEach(function(m, i) {
            m.is_default = (i === index);
          });
          savePaymentMethods(methods);
          box.querySelector('#payment-methods-list').innerHTML = renderMethods();
          attachPaymentMethodListeners();
        });
      });

      box.querySelectorAll('.edit-payment').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var index = parseInt(btn.getAttribute('data-index'));
          document.body.removeChild(modal);
          showAddEditPaymentMethod(methods[index], index);
        });
      });

      box.querySelectorAll('.delete-payment').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var index = parseInt(btn.getAttribute('data-index'));
          if (confirm('Are you sure you want to delete this payment method?')) {
            methods.splice(index, 1);
            savePaymentMethods(methods);
            box.querySelector('#payment-methods-list').innerHTML = renderMethods();
            attachPaymentMethodListeners();
          }
        });
      });
    }

    // Add payment method
    box.querySelector('#add-payment-method').addEventListener('click', function() {
      document.body.removeChild(modal);
      showAddEditPaymentMethod();
    });

    attachPaymentMethodListeners();

    box.querySelector('#close-payment-methods').addEventListener('click', function() {
      document.body.removeChild(modal);
    });
  }

  // Show add/edit payment method modal
  function showAddEditPaymentMethod(method, index) {
    var isEdit = method !== undefined;
    var methods = getPaymentMethods();
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1003;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:30px;border-radius:12px;max-width:500px;width:90%;max-height:90vh;overflow-y:auto;';

    box.innerHTML = '<h3 style="color:#ff6f61;margin-bottom:20px;">' + (isEdit ? 'Edit' : 'Add') + ' Payment Method</h3>' +
      '<div style="margin-bottom:15px;">' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Card Nickname (optional)</label>' +
      '<input id="payment-nickname" type="text" placeholder="e.g., My Visa Card" value="' + (method ? (method.nickname || '') : '') + '" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '</div>' +
      '<div style="margin-bottom:15px;">' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Card Type</label>' +
      '<select id="payment-type" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '<option value="credit"' + (method && method.type === 'credit' ? ' selected' : '') + '>Credit Card</option>' +
      '<option value="debit"' + (method && method.type === 'debit' ? ' selected' : '') + '>Debit Card</option>' +
      '</select>' +
      '</div>' +
      '<div style="margin-bottom:15px;">' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Card Number</label>' +
      '<input id="payment-card-number" type="text" placeholder="1234 5678 9012 3456" value="' + (method ? (method.card_number || '') : '') + '" maxlength="19" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">' +
      '<div>' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Expiry Month</label>' +
      '<input id="payment-expiry-month" type="number" placeholder="MM" min="1" max="12" value="' + (method ? (method.expiry_month || '') : '') + '" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '</div>' +
      '<div>' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">Expiry Year</label>' +
      '<input id="payment-expiry-year" type="number" placeholder="YYYY" min="2025" value="' + (method ? (method.expiry_year || '') : '') + '" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '</div>' +
      '</div>' +
      '<div style="margin-bottom:15px;">' +
      '<label style="display:block;margin-bottom:5px;font-weight:600;color:#333;">CVV</label>' +
      '<input id="payment-cvv" type="text" placeholder="123" maxlength="4" value="' + (method ? (method.cvv || '') : '') + '" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;">' +
      '</div>' +
      '<div style="margin-bottom:20px;">' +
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
      '<input type="checkbox" id="payment-is-default"' + (method && method.is_default ? ' checked' : (methods.length === 0 ? ' checked' : '')) + ' style="width:18px;height:18px;">' +
      '<span style="font-weight:600;color:#333;">Set as default payment method</span>' +
      '</label>' +
      '</div>' +
      '<div id="payment-error" style="color:#f44336;margin-bottom:15px;min-height:20px;font-size:14px;"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button id="cancel-payment" style="padding:12px 24px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;cursor:pointer;font-weight:600;">Cancel</button>' +
      '<button id="save-payment" style="padding:12px 24px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;font-weight:600;">' + (isEdit ? 'Update' : 'Add') + ' Payment Method</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    // Format card number with spaces
    var cardInput = box.querySelector('#payment-card-number');
    cardInput.addEventListener('input', function() {
      var value = this.value.replace(/\s/g, '');
      var formatted = value.match(/.{1,4}/g)?.join(' ') || value;
      if (formatted.length <= 19) {
        this.value = formatted;
      }
    });

    box.querySelector('#cancel-payment').addEventListener('click', function() {
      document.body.removeChild(modal);
      if (!isEdit) {
        showPaymentMethods();
      }
    });

    box.querySelector('#save-payment').addEventListener('click', function() {
      var nickname = box.querySelector('#payment-nickname').value.trim();
      var type = box.querySelector('#payment-type').value;
      var cardNumber = box.querySelector('#payment-card-number').value.replace(/\s/g, '');
      var expiryMonth = box.querySelector('#payment-expiry-month').value;
      var expiryYear = box.querySelector('#payment-expiry-year').value;
      var cvv = box.querySelector('#payment-cvv').value;
      var isDefault = box.querySelector('#payment-is-default').checked;
      var errorEl = box.querySelector('#payment-error');

      errorEl.textContent = '';

      if (!cardNumber || cardNumber.length < 13) {
        errorEl.textContent = 'Please enter a valid card number.';
        return;
      }
      if (!expiryMonth || expiryMonth < 1 || expiryMonth > 12) {
        errorEl.textContent = 'Please enter a valid expiry month (1-12).';
        return;
      }
      if (!expiryYear || expiryYear < 2025) {
        errorEl.textContent = 'Please enter a valid expiry year.';
        return;
      }
      if (!cvv || cvv.length < 3) {
        errorEl.textContent = 'Please enter a valid CVV.';
        return;
      }

      var paymentMethod = {
        id: method ? method.id : generateId(),
        nickname: nickname || null,
        type: type,
        card_number: cardNumber,
        expiry_month: parseInt(expiryMonth),
        expiry_year: parseInt(expiryYear),
        cvv: cvv,
        is_default: isDefault
      };

      if (isDefault) {
        methods.forEach(function(m) {
          m.is_default = false;
        });
      }

      if (isEdit && index !== undefined) {
        methods[index] = paymentMethod;
      } else {
        methods.push(paymentMethod);
      }

      savePaymentMethods(methods);
      document.body.removeChild(modal);
      showPaymentMethods();
    });
  }

  // Show order history modal
  function showOrderHistory() {
    var user = getCurrentUser();
    if (!user) return;

    var orders = getUserOrders();
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:white;padding:30px;border-radius:12px;max-width:800px;width:90%;max-height:90vh;overflow-y:auto;';

    function formatDate(timestamp) {
      if (!timestamp) return 'N/A';
      var date = new Date(timestamp);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    function getStatusColor(status) {
      var colors = {
        'pending': '#ff9800',
        'confirmed': '#2196f3',
        'delivered': '#4caf50',
        'cancelled': '#f44336'
      };
      return colors[status] || '#666';
    }

    function renderOrders() {
      if (orders.length === 0) {
        return '<div style="text-align:center;padding:40px;color:#999;">No orders yet.</div>';
      }
      return orders.map(function(order) {
        var total = 0;
        var itemsHtml = '';
        var totalSavings = order.total_savings || 0;
        if (order.items && order.items.length > 0) {
          order.items.forEach(function(item) {
            var itemTotal = (item.price || 0) * (item.quantity || 1);
            total += itemTotal;
            var itemSavings = item.savings || ((item.old_price && item.old_price > item.price) ? (item.old_price - item.price) * (item.quantity || 1) : 0);
            var itemOriginalTotal = item.old_price ? item.old_price * (item.quantity || 1) : itemTotal;
            var savingsHtml = itemSavings > 0 ? '<div style="font-size:10px;color:#4caf50;margin-top:2px;">💚 Saved: ¥' + itemSavings.toFixed(0) + '</div>' : '';
            var priceDisplay = itemSavings > 0 ? '<div style="text-align:right;"><span style="text-decoration:line-through;color:#999;font-size:10px;">¥' + itemOriginalTotal.toFixed(0) + '</span><br><span style="color:#ff6f61;font-weight:600;">¥' + itemTotal.toFixed(0) + '</span></div>' : '<span>¥' + itemTotal.toFixed(0) + '</span>';
            itemsHtml += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;">' +
              '<div><span>' + (item.name || 'Item') + ' x' + (item.quantity || 1) + '</span>' + savingsHtml + '</div>' +
              '<div>' + priceDisplay + '</div>' +
              '</div>';
          });
        }
        var addressHtml = order.address ? '<div style="margin:8px 0;padding:6px;background:#f5f5f5;border-radius:4px;"><small style="color:#666;">📍 ' + order.address + '</small></div>' : '';
        var timeHtml = order.estimated_delivery_time ? '<div style="margin:8px 0;padding:6px;background:#e3f2fd;border-radius:4px;"><small style="color:#1976d2;">⏱️ Estimated: ' + order.estimated_delivery_time + ' minutes</small></div>' : '';
        var savingsHtml = totalSavings > 0 ? '<div style="margin:8px 0;padding:8px;background:#e8f5e9;border-radius:4px;border:1px solid #4caf50;"><small style="color:#2e7d32;font-weight:600;">💰 Total Savings: ¥' + totalSavings.toFixed(0) + '</small></div>' : '';
        return '<div style="border:2px solid #eee;border-radius:8px;padding:15px;margin-bottom:15px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
          '<div><strong>Order #' + order.id + '</strong><br><small style="color:#666;">' + formatDate(order.created_at) + '</small></div>' +
          '<span style="padding:6px 12px;border-radius:6px;background:' + getStatusColor(order.status) + ';color:white;font-size:12px;font-weight:600;">' + (order.status || 'pending').toUpperCase() + '</span>' +
          '</div>' +
          addressHtml +
          timeHtml +
          '<div style="margin:10px 0;">' + itemsHtml + '</div>' +
          savingsHtml +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:2px solid #eee;">' +
          '<strong>Total: ¥' + total.toFixed(2) + '</strong>' +
          (order.status === 'pending' ? '<div style="display:flex;gap:8px;"><button class="cancel-order-btn" data-order-id="' + order.id + '" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:12px;">Cancel</button>' +
          '<button class="track-order-history-btn" data-order-id="' + order.id + '" style="padding:6px 12px;border-radius:6px;border:none;background:#2196f3;color:white;cursor:pointer;font-size:12px;">Track</button></div>' : '') +
          '</div>' +
          '</div>';
      }).join('');
    }

    box.innerHTML = '<h2 style="color:#ff6f61;margin-bottom:20px;">Order History</h2>' +
      '<div id="order-history-list">' + renderOrders() + '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:20px;">' +
      '<button id="order-history-close" style="padding:10px 20px;border-radius:6px;border:1px solid #ccc;background:white;cursor:pointer;">Close</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    document.getElementById('order-history-close').addEventListener('click', function() {
      document.body.removeChild(modal);
    });

    // Use event delegation for cancel order buttons
    if (!box._cancelOrderHandlerAttached) {
      box.addEventListener('click', function(e) {
        var cancelBtn = e.target;
        while (cancelBtn && cancelBtn !== box && !cancelBtn.classList.contains('cancel-order-btn')) {
          cancelBtn = cancelBtn.parentElement;
        }
        
        if (!cancelBtn || cancelBtn === box || !cancelBtn.classList.contains('cancel-order-btn')) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        var orderId = parseInt(cancelBtn.getAttribute('data-order-id'));
        if (isNaN(orderId)) return;
        
        if (confirm('Are you sure you want to cancel this order?')) {
          var allOrders = getStorage(STORAGE_ORDERS, []);
          var orderIndex = allOrders.findIndex(function(o) { return o.id === orderId && o.user_id === user.id; });
          if (orderIndex >= 0) {
            allOrders[orderIndex].status = 'cancelled';
            setStorage(STORAGE_ORDERS, allOrders);
            orders = getUserOrders();
            box.querySelector('#order-history-list').innerHTML = renderOrders();
            // Re-attach other listeners if needed
            attachOrderHistoryListeners();
          }
        }
      });
      box._cancelOrderHandlerAttached = true;
    }
    
    function attachOrderHistoryListeners() {

      box.querySelectorAll('.track-order-history-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var orderId = parseInt(btn.getAttribute('data-order-id'));
          var order = orders.find(function(o) { return o.id === orderId; });
          if (order) {
            document.body.removeChild(modal);
            showOrderTracking(order);
          }
        });
      });
    }

    attachOrderHistoryListeners();
  }

  // Owner dashboard modal: add/manage restaurants
  function showOwnerDashboard() {
    var user = getCurrentUser();
    if (!user || user.role !== 'owner') return;

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1002;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:22px;border-radius:12px;max-width:720px;width:95%;max-height:90vh;overflow:auto;';

    var restaurants = getRestaurants().filter(function(r){ return r.owner_id === user.id; });
    function deleteRestaurant(restId) {
      // Remove restaurant
      var all = getRestaurants();
      all = all.filter(function(r){ return r.id !== restId; });
      setStorage(STORAGE_RESTAURANTS, all);
      // Remove its menu items
      var allItems = getStorage(STORAGE_MENU_ITEMS, []);
      allItems = allItems.filter(function(it){ return it.restaurant_id !== restId; });
      setStorage(STORAGE_MENU_ITEMS, allItems);
    }

    function updateRestaurant(rest) {
      var all = getRestaurants();
      var idx = all.findIndex(function(r){ return r.id === rest.id; });
      if (idx >= 0) { all[idx] = rest; } else { all.push(rest); }
      setStorage(STORAGE_RESTAURANTS, all);
      return rest;
    }

    function renderList() {
      var rows = restaurants.map(function(r){
        return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #eee;">' +
          (r.image_url ? '<img src="'+r.image_url+'" style="width:44px;height:44px;border-radius:8px;object-fit:cover;">' : '') +
          '<div style="flex:1;">'+
          '<div style="font-weight:600;">'+ (r.name || '') +'</div>'+ 
          '<div style="font-size:12px;color:#666;">'+ (r.area||'-') +' · '+ (r.cuisine||'-') +' · '+ (function(){ var pl = (r.price_level||'¥'); if(pl==='$')return'¥';if(pl==='$$')return'¥¥';if(pl==='$$$')return'¥¥¥';return pl;})() + (r.halal ? ' · 🕌 Halal' : '') +'</div>'+ 
          (r.link ? '<div style="font-size:12px;color:#999;">'+ r.link +'</div>' : '') +
          '</div>'+
          '<button class="mmOwnerEdit" data-id="'+r.id+'" style="padding:8px 10px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;cursor:pointer;">Edit</button>'+
          '<button class="mmOwnerDel" data-id="'+r.id+'" style="padding:8px 10px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#b00020;cursor:pointer;">Delete</button>'+
        '</div>';
      }).join('');
      return rows || '<div style="color:#666;">No restaurants yet.</div>';
    }

    box.innerHTML = '<h2 style="color:#ff6f61;margin-bottom:10px;">Owner Dashboard</h2>'+
      '<p style="margin-bottom:14px;">Add your restaurants. They will appear on the Restaurants page.</p>'+
      '<div id="mmOwnerList" style="margin-bottom:16px;">'+ renderList() +'</div>'+
      '<h3 style="color:#ff6f61;margin:10px 0;">Add New Restaurant</h3>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'+
      '<input id="mmRestName" placeholder="Name" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '<input id="mmRestArea" placeholder="Area (e.g., Kamegawa)" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '<select id="mmRestCuisine" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '<option value="">Select Cuisine</option>'+
      '<option value="Japanese">Japanese</option>'+
      '<option value="Chinese">Chinese</option>'+
      '<option value="Italian">Italian</option>'+
      '<option value="Other">Other</option>'+
      '</select>'+
      '<select id="mmRestPrice" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '<option value="¥">¥</option><option value="¥¥">¥¥</option><option value="¥¥¥">¥¥¥</option></select>'+
      '<label style="grid-column:1/3;display:flex;align-items:center;gap:8px;padding:8px;"><input type="checkbox" id="mmRestHalal" style="width:18px;height:18px;"> Halal certified</label>'+
      '<input id="mmRestLink" placeholder="Optional page link (e.g., ./myrest.html)" style="grid-column:1/3;padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '<input id="mmRestImage" type="file" accept="image/*" style="grid-column:1/3;padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '</div>'+
      '<div id="mmOwnerError" style="color:#b00020;min-height:1.2em;margin-top:8px;"></div>'+
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;">'+
      '<button id="mmOwnerClose" style="padding:10px 16px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">Close</button>'+
      '<button id="mmOwnerAdd" style="padding:10px 16px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;">Add Restaurant</button>'+
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    function refreshListOnly(){
      restaurants = getRestaurants().filter(function(r){ return r.owner_id === user.id; });
      var listEl = box.querySelector('#mmOwnerList');
      listEl.innerHTML = renderList();
      // Event delegation (robust)
      if (!listEl._mmBound) {
        listEl.addEventListener('click', function(e){
          var delBtn = e.target.closest('.mmOwnerDel');
          if (delBtn) {
            e.preventDefault(); e.stopPropagation();
            var id = delBtn.getAttribute('data-id');
            if (!id) return;
            var proceed = true; try { proceed = window.confirm('Delete this restaurant? This will also remove its menu items.'); } catch(_) { proceed = true; }
            if (!proceed) return;
            deleteRestaurant(id);
            refreshListOnly();
            try {
              var sel = box.querySelector('#mmMenuRest');
              if (sel && sel.value === id) {
                var ownedAfter = refreshMenuRestOptions();
                sel.value = ownedAfter[0] ? ownedAfter[0].id : '';
                if (sel.value) { renderMenuList(sel.value); } else { var ml = box.querySelector('#mmMenuList'); if (ml) ml.innerHTML = '<div style="color:#666;">Add a restaurant first to manage its menu.</div>'; }
              }
            } catch(_) {}
            try { initRestaurantFilters(); } catch(_) {}
            return;
          }

          var editBtn = e.target.closest('.mmOwnerEdit');
          if (editBtn) {
            e.preventDefault(); e.stopPropagation();
            var id2 = editBtn.getAttribute('data-id');
            var all = getRestaurants();
            var r = all.find(function(x){ return x.id === id2; });
            if (!r) return;
          var emodal = document.createElement('div');
          emodal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1003;display:flex;align-items:center;justify-content:center;';
          var ebox = document.createElement('div');
          ebox.style.cssText = 'background:#fff;padding:20px;border-radius:10px;max-width:600px;width:95%;';
          ebox.innerHTML = '<h3 style="color:#ff6f61;margin-bottom:10px;">Edit Restaurant</h3>'+
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'+
            '<input id="mmEditName" value="'+(r.name||'')+'" placeholder="Name" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
            '<input id="mmEditArea" value="'+(r.area||'')+'" placeholder="Area" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
            '<select id="mmEditCuisine" style="padding:10px;border:1px solid #ccc;border-radius:8px;"><option value="">Select Cuisine</option><option value="Japanese">Japanese</option><option value="Chinese">Chinese</option><option value="Italian">Italian</option><option value="Other">Other</option></select>'+
            '<select id="mmEditPrice" style="padding:10px;border:1px solid #ccc;border-radius:8px;"><option value="¥">¥</option><option value="¥¥">¥¥</option><option value="¥¥¥">¥¥¥</option></select>'+
            '<label style="grid-column:1/3;display:flex;align-items:center;gap:8px;padding:8px;"><input type="checkbox" id="mmEditHalal" '+(r.halal?'checked':'')+' style="width:18px;height:18px;"> Halal certified</label>'+
            '<input id="mmEditLink" value="'+(r.link||'')+'" placeholder="Optional page link" style="grid-column:1/2;padding:10px;border:1px solid #ccc;border-radius:8px;">'+
            '<input id="mmEditImage" type="file" accept="image/*" style="grid-column:1/3;padding:10px;border:1px solid #ccc;border-radius:8px;">'+
            '</div>'+
            '<div id="mmEditErr" style="color:#b00020;min-height:1.2em;margin-top:8px;"></div>'+
            '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;">'+
            '<button id="mmEditCancel" style="padding:10px 16px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">Cancel</button>'+
            '<button id="mmEditSave" style="padding:10px 16px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;">Save</button>'+
            '</div>';
          emodal.appendChild(ebox);
          document.body.appendChild(emodal);
          // Set current price level and cuisine
          var sel = ebox.querySelector('#mmEditPrice'); sel.value = r.price_level || '¥';
          var selCuisine = ebox.querySelector('#mmEditCuisine'); if (selCuisine) selCuisine.value = r.cuisine || '';
          ebox.querySelector('#mmEditCancel').onclick = function(){ document.body.removeChild(emodal); };
          ebox.querySelector('#mmEditSave').onclick = function(){
            var name = ebox.querySelector('#mmEditName').value.trim();
            var area = ebox.querySelector('#mmEditArea').value.trim();
            var cuisine = ebox.querySelector('#mmEditCuisine').value.trim();
            var price = ebox.querySelector('#mmEditPrice').value;
            var halal = ebox.querySelector('#mmEditHalal').checked;
            var link = ebox.querySelector('#mmEditLink').value.trim();
            var file = ebox.querySelector('#mmEditImage').files[0];
            var err = ebox.querySelector('#mmEditErr');
            err.textContent = '';
            if (!name) { err.textContent = 'Name is required.'; return; }
            function finish(img){
              var updated = { id: r.id, owner_id: r.owner_id, name: name, area: area, cuisine: cuisine, price_level: price, halal: halal, image_url: (img!=null?img:r.image_url||null), link: link||null };
              updateRestaurant(updated);
              refreshListOnly();
              try { initRestaurantFilters(); } catch(_) {}
              document.body.removeChild(emodal);
            }
            if (file) {
              fileToBase64(file).then(function(b64){ finish(b64); }).catch(function(){ err.textContent='Image upload failed.'; });
            } else { finish(null); }
          };
          }
        }, false);
        listEl._mmBound = true;
      }
      // Keep menu restaurant selector in sync
      refreshMenuRestOptions();
    }

    box.querySelector('#mmOwnerClose').onclick = function(){ document.body.removeChild(modal); };
    box.querySelector('#mmOwnerAdd').onclick = function(){
      var name = box.querySelector('#mmRestName').value.trim();
      var area = box.querySelector('#mmRestArea').value.trim();
      var cuisine = box.querySelector('#mmRestCuisine').value.trim();
      var price = box.querySelector('#mmRestPrice').value;
      var halal = box.querySelector('#mmRestHalal').checked;
      var link = box.querySelector('#mmRestLink').value.trim();
      var file = box.querySelector('#mmRestImage').files[0];
      var err = box.querySelector('#mmOwnerError');
      err.textContent = '';
      if (!name) { err.textContent = 'Name is required.'; return; }

      function saveWithImage(imageUrl){
        var restaurant = {
          id: generateId(),
          owner_id: user.id,
          name: name,
          area: area,
          cuisine: cuisine,
          price_level: price,
          halal: halal,
          image_url: imageUrl || null,
          link: link || null
        };
        var saved = saveRestaurant(restaurant);
        refreshListOnly();
        // If on restaurants page, re-run filters to show the new one
        try { initRestaurantFilters(); } catch(e) {}
        // Update menu section selector to newly added restaurant
        try {
          var sel = box.querySelector('#mmMenuRest');
          if (sel && saved && saved.id) {
            refreshMenuRestOptions();
            sel.value = saved.id;
            renderMenuList(saved.id);
          }
        } catch(e) {}
      }

      if (file) {
        fileToBase64(file).then(function(b64){ saveWithImage(b64); }).catch(function(){ err.textContent='Image upload failed.'; });
      } else {
        saveWithImage(null);
      }
    };

    // MENU MANAGEMENT SECTION
    var menuSection = document.createElement('div');
    menuSection.style.cssText = 'margin-top:18px;padding-top:12px;border-top:1px solid #eee;';
    menuSection.innerHTML = '<h3 style="color:#ff6f61;margin:10px 0;">Manage Menu Items</h3>'+
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">'+
      '<label>Select Restaurant:</label>'+
      '<select id="mmMenuRest" style="padding:8px;border:1px solid #ccc;border-radius:8px;"></select>'+
      '</div>'+
      '<div id="mmMenuList" style="margin-bottom:10px;"></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'+
      '<input id="mmMenuName" placeholder="Item name" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '<input id="mmMenuOriginalPrice" type="number" step="0.01" placeholder="Original Price (¥)" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '<input id="mmMenuPrice" type="number" step="0.01" placeholder="Discount Price (¥)" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '<input id="mmMenuImage" type="file" accept="image/*" style="grid-column:1/3;padding:10px;border:1px solid #ccc;border-radius:8px;">'+
      '</div>'+
      '<div id="mmMenuError" style="color:#b00020;min-height:1.2em;margin-top:8px;"></div>'+
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;">'+
      '<button id="mmMenuAdd" style="padding:10px 16px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;">Add Menu Item</button>'+
      '</div>';
    box.appendChild(menuSection);

    function refreshMenuRestOptions() {
      var select = box.querySelector('#mmMenuRest');
      var owned = getRestaurants().filter(function(r){ return r.owner_id === user.id; });
      select.innerHTML = owned.map(function(r){ return '<option value="'+r.id+'">'+r.name+'</option>'; }).join('');
      return owned;
    }

    function deleteMenuItem(itemId) {
      var allItems = getStorage(STORAGE_MENU_ITEMS, []);
      allItems = allItems.filter(function(i){ return i.id !== itemId; });
      setStorage(STORAGE_MENU_ITEMS, allItems);
    }

    function renderMenuList(restId) {
      var listEl = box.querySelector('#mmMenuList');
      var items = getMenuItems(restId);
      listEl.innerHTML = items.map(function(it){
        var priceDisplay = '';
        if (it.old_price && it.old_price > it.price) {
          var discountPercent = Math.round(((it.old_price - it.price) / it.old_price) * 100);
          priceDisplay = '<div style="text-align:right;"><div style="font-size:13px;font-weight:700;color:#ff6f61;">¥'+ (it.price||0).toFixed(0) +'</div><div style="font-size:11px;color:#999;text-decoration:line-through;">¥'+ (it.old_price||0).toFixed(0) +'</div><div style="font-size:10px;color:#4caf50;">'+ discountPercent +'% Off</div></div>';
        } else {
          priceDisplay = '<div style="font-size:13px;font-weight:700;color:#ff6f61;">¥'+ (it.price||0).toFixed(0) +'</div>';
        }
        return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #eee;">'+
          (it.image_url ? '<img src="'+it.image_url+'" style="width:40px;height:40px;border-radius:6px;object-fit:cover;">' : '')+
          '<div style="flex:1;">'+ it.name +'</div>'+
          priceDisplay +
          '<div style="display:flex;gap:6px;">'+
          '<button class="mmMenuEdit" data-id="'+it.id+'" style="padding:6px 10px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#333;cursor:pointer;">Edit</button>'+
          '<button class="mmMenuDel" data-id="'+it.id+'" style="padding:6px 10px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#b00020;cursor:pointer;">Delete</button>'+
          '</div>'+
        '</div>';
      }).join('') || '<div style="color:#666;">No items yet.</div>';

      // Bind item edit/delete
      Array.prototype.forEach.call(listEl.querySelectorAll('.mmMenuDel'), function(btn){
        btn.addEventListener('click', function(){
          var id = btn.getAttribute('data-id');
          if (!id) return;
          var ok = true; try { ok = confirm('Delete this item?'); } catch(_) {}
          if (!ok) return;
          deleteMenuItem(id);
          renderMenuList(restId);
        });
      });
      Array.prototype.forEach.call(listEl.querySelectorAll('.mmMenuEdit'), function(btn){
        btn.addEventListener('click', function(){
          var id = btn.getAttribute('data-id');
          var all = getStorage(STORAGE_MENU_ITEMS, []);
          var it = all.find(function(x){ return x.id === id; });
          if (!it) return;
          var m = document.createElement('div'); m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1003;display:flex;align-items:center;justify-content:center;';
          var b = document.createElement('div'); b.style.cssText='background:#fff;padding:20px;border-radius:10px;max-width:500px;width:95%;';
          b.innerHTML = '<h3 style="color:#ff6f61;margin-bottom:10px;">Edit Menu Item</h3>'+
            '<input id="mmItemName" value="'+(it.name||'')+'" placeholder="Name" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">'+
            '<input id="mmItemOriginalPrice" type="number" step="0.01" value="'+(it.old_price||'')+'" placeholder="Original Price (¥)" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">'+
            '<input id="mmItemPrice" type="number" step="0.01" value="'+(it.price||0)+'" placeholder="Discount Price (¥)" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">'+
            '<input id="mmItemImage" type="file" accept="image/*" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">'+
            '<div style="display:flex;gap:10px;justify-content:flex-end;">'+
            '<button id="mmItemCancel" style="padding:10px 16px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">Cancel</button>'+
            '<button id="mmItemSave" style="padding:10px 16px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;">Save</button>'+
            '</div>';
          m.appendChild(b); document.body.appendChild(m);
          b.querySelector('#mmItemCancel').onclick = function(){ document.body.removeChild(m); };
          b.querySelector('#mmItemSave').onclick = function(){
            var name = b.querySelector('#mmItemName').value.trim();
            var originalPrice = parseFloat(b.querySelector('#mmItemOriginalPrice').value||'0');
            var price = parseFloat(b.querySelector('#mmItemPrice').value||'0');
            var file = b.querySelector('#mmItemImage').files[0];
            if (isNaN(price) || price <= 0) { alert('Enter a valid discount price.'); return; }
            if (originalPrice > 0 && originalPrice <= price) { alert('Original price must be greater than discount price.'); return; }
            function finish(img){
              var all2 = getStorage(STORAGE_MENU_ITEMS, []);
              var idx = all2.findIndex(function(x){ return x.id === it.id; });
              if (idx >= 0) {
                all2[idx] = { 
                  id: it.id, 
                  restaurant_id: it.restaurant_id, 
                  name: name||it.name, 
                  price: isNaN(price)?it.price:price, 
                  old_price: (originalPrice > 0 && originalPrice > price) ? originalPrice : null,
                  image_url: img!=null?img:it.image_url||null 
                };
              }
              setStorage(STORAGE_MENU_ITEMS, all2);
              document.body.removeChild(m);
              renderMenuList(restId);
            }
            if (file) { fileToBase64(file).then(function(b64){ finish(b64); }); } else { finish(null); }
          };
        });
      });
    }

    var ownedNow = refreshMenuRestOptions();
    var firstRest = ownedNow[0] && ownedNow[0].id;
    if (firstRest) {
      renderMenuList(firstRest);
    } else {
      // Clear menu list when no restaurants yet
      var ml = box.querySelector('#mmMenuList');
      if (ml) ml.innerHTML = '<div style="color:#666;">Add a restaurant first to manage its menu.</div>';
    }

    // Ensure edit/delete buttons in the initial restaurant list are bound
    refreshListOnly();

    box.querySelector('#mmMenuRest').addEventListener('change', function(){
      renderMenuList(this.value);
    });

    box.querySelector('#mmMenuAdd').addEventListener('click', function(){
      var restId = box.querySelector('#mmMenuRest').value;
      if (!restId) { box.querySelector('#mmMenuError').textContent = 'Please add/select a restaurant first.'; return; }
      var name = box.querySelector('#mmMenuName').value.trim();
      var originalPrice = parseFloat(box.querySelector('#mmMenuOriginalPrice').value || '0');
      var price = parseFloat(box.querySelector('#mmMenuPrice').value || '0');
      var file = box.querySelector('#mmMenuImage').files[0];
      var err = box.querySelector('#mmMenuError');
      err.textContent = '';
      if (!name) { err.textContent = 'Item name is required.'; return; }
      if (isNaN(price) || price <= 0) { err.textContent = 'Enter a valid discount price.'; return; }
      if (originalPrice > 0 && originalPrice <= price) { err.textContent = 'Original price must be greater than discount price.'; return; }
      function saveItem(imageUrl){
        saveMenuItem({ 
          id: generateId(), 
          restaurant_id: restId, 
          name: name, 
          price: price, 
          old_price: (originalPrice > 0 && originalPrice > price) ? originalPrice : null,
          image_url: imageUrl || null 
        });
        box.querySelector('#mmMenuName').value = '';
        box.querySelector('#mmMenuOriginalPrice').value = '';
        box.querySelector('#mmMenuPrice').value = '';
        box.querySelector('#mmMenuImage').value = '';
        renderMenuList(restId);
      }
      if (file) {
        fileToBase64(file).then(function(b64){ saveItem(b64); }).catch(function(){ err.textContent='Image upload failed.'; });
      } else {
        saveItem(null);
      }
    });
  }

  // Initialize owner dashboard dedicated page
  function initOwnerDashboardPage() {
    try {
      var isOwnerPage = /owner\.html$/i.test(location.pathname);
      if (!isOwnerPage) return;

      var container = document.getElementById('owner-dashboard');
      if (!container) return;

      var user = getCurrentUser();
      if (!user) { window.location.href = 'login.html'; return; }
      if (user.role !== 'owner') { window.location.href = 'index.html'; return; }

      // Build inline dashboard UI (same features as modal version)
      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'max-width:1000px;margin:20px auto;background:#fff;padding:30px;border-radius:15px;box-shadow:0 8px 24px rgba(0,0,0,0.1);border:1px solid #eee;';

      // Stats helpers
      function getOwnerRestaurantIds() {
        // Get restaurants from localStorage
        var localRestaurants = getRestaurants().filter(function(r){ 
          return String(r.owner_id) === String(user.id); 
        });
        var restIds = localRestaurants.map(function(r){ return String(r.id); });
        
        // Also try to fetch from API to ensure we have all restaurants
        // This ensures newly created restaurants are included
        if (typeof fetch === 'function') {
          fetch('/api/restaurants')
            .then(function(res) { return res.json(); })
            .then(function(data) {
              var apiRestaurants = data.restaurants || [];
              var ownerApiRestaurants = apiRestaurants.filter(function(r) { 
                return String(r.owner_id) === String(user.id); 
              });
              // Store API restaurants in localStorage
              var allRestaurants = getRestaurants();
              ownerApiRestaurants.forEach(function(apiRest) {
                var existing = allRestaurants.findIndex(function(r) { 
                  return String(r.id) === String(apiRest.id); 
                });
                if (existing >= 0) {
                  allRestaurants[existing] = apiRest;
                } else {
                  allRestaurants.push(apiRest);
                }
              });
              setStorage(STORAGE_RESTAURANTS, allRestaurants);
            })
            .catch(function(err) {
              console.error('Error fetching restaurants for owner:', err);
            });
        }
        
        return restIds;
      }
      function getAllOrders() { return getStorage(STORAGE_ORDERS, []) || []; }
      function getRestaurantById(restId) {
        // Convert to string for consistent comparison
        var restIdStr = String(restId);
        return getRestaurants().find(function(r){ return String(r.id) === restIdStr; });
      }
      function formatYen(n){ try { return '¥' + (n||0).toFixed(0); } catch(_) { return '¥0'; } }
      function formatDate(timestamp) {
        if (!timestamp) return 'Unknown date';
        try {
          var d = new Date(timestamp);
          return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        } catch(_) { return 'Unknown date'; }
      }

      function getOwnerOrders() {
        var restIds = getOwnerRestaurantIds();
        // Convert to strings for consistent comparison
        var restIdStrings = restIds.map(function(id) { return String(id); });
        var allItems = getStorage(STORAGE_MENU_ITEMS, []) || [];
        var menuById = {};
        allItems.forEach(function(it){ menuById[String(it.id)] = it; });
        var orders = getAllOrders();
        var ownerOrders = [];
        orders.forEach(function(o){
          var orderHasOwnerItem = false;
          var orderTotal = 0;
          var restaurantAreas = [];
          (o.items||[]).forEach(function(line){
            var matched = false;
            var restaurantId = null;
            
            // Try to find menu item by menu_item_id
            var menu = menuById[String(line.menu_item_id)];
            if (menu) {
              restaurantId = String(menu.restaurant_id);
            } else if (line.restaurant_id) {
              // If menu item not found, use restaurant_id directly from order item
              restaurantId = String(line.restaurant_id);
            }
            
            // Check if this restaurant belongs to the owner
            if (restaurantId && restIdStrings.indexOf(restaurantId) !== -1) {
              orderHasOwnerItem = true;
              orderTotal += (line.price||0) * (line.quantity||0);
              var rest = getRestaurantById(restaurantId);
              if (rest && rest.area && restaurantAreas.indexOf(rest.area) === -1) {
                restaurantAreas.push(rest.area);
              }
            }
          });
          if (orderHasOwnerItem) {
            ownerOrders.push({
              order: o,
              total: orderTotal,
              location: restaurantAreas.join(', ') || 'N/A'
            });
          }
        });
        return ownerOrders.sort(function(a, b){ return (b.order.created_at || 0) - (a.order.created_at || 0); });
      }

      var statsEl = document.createElement('div');
      statsEl.id = 'pgOwnerStats';
      statsEl.style.cssText = 'margin-bottom:32px;';
      
      function calculateEarningsByPeriod(orders, selectedMonth, selectedYear) {
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        var thisYear = new Date(now.getFullYear(), 0, 1);
        
        // Custom month/year selection
        var customMonthStart = null;
        var customMonthEnd = null;
        var customYearStart = null;
        var customYearEnd = null;
        
        if (selectedMonth !== null && selectedYear !== null) {
          // Specific month and year
          customMonthStart = new Date(selectedYear, selectedMonth, 1);
          customMonthEnd = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999);
        } else if (selectedYear !== null && selectedMonth === null) {
          // Specific year only
          customYearStart = new Date(selectedYear, 0, 1);
          customYearEnd = new Date(selectedYear, 11, 31, 23, 59, 59, 999);
        }
        
        var dayEarnings = 0;
        var monthEarnings = 0;
        var yearEarnings = 0;
        var totalEarnings = 0;
        var customEarnings = 0;
        
        orders.forEach(function(oo){
          var orderDate = new Date(oo.order.created_at || 0);
          var amount = oo.total;
          totalEarnings += amount;
          
          // Standard periods
          if (orderDate >= thisYear) yearEarnings += amount;
          if (orderDate >= thisMonth) monthEarnings += amount;
          if (orderDate >= today) dayEarnings += amount;
          
          // Custom month/year
          if (customMonthStart && orderDate >= customMonthStart && orderDate <= customMonthEnd) {
            customEarnings += amount;
          }
          // Custom year only
          if (customYearStart && orderDate >= customYearStart && orderDate <= customYearEnd) {
            customEarnings += amount;
          }
        });
        
        return {
          day: dayEarnings,
          month: monthEarnings,
          year: yearEarnings,
          total: totalEarnings,
          custom: customEarnings
        };
      }

      var currentEarningsPeriod = 'total';
      var selectedMonth = null; // null means use current period, 0-11 for specific month
      var selectedYear = null; // null means use current period, number for specific year
      function renderStats(){
        var ownerOrders = getOwnerOrders();
        // Only count completed orders for earnings (not pending or confirmed)
        var completedOrders = ownerOrders.filter(function(oo){ return oo.order.status === 'delivered'; });
        var earnings = calculateEarningsByPeriod(completedOrders, selectedMonth, selectedYear);
        var allOrders = ownerOrders; // All orders for Total Orders section
        var ongoingOrders = ownerOrders.filter(function(oo){ return oo.order.status === 'pending' || oo.order.status === 'confirmed'; });

        // Get labels and amounts based on current period
        var now = new Date();
        var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        
        var labels = {
          day: 'Today\'s Earnings',
          month: selectedMonth !== null && selectedYear !== null ? monthNames[selectedMonth] + ' ' + selectedYear + ' Earnings' : 'This Month\'s Earnings',
          year: selectedYear !== null && selectedMonth === null ? selectedYear + ' Earnings' : 'This Year\'s Earnings',
          total: 'Total Earnings<br><span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;">Since Joining</span>',
          custom: selectedMonth !== null && selectedYear !== null ? monthNames[selectedMonth] + ' ' + selectedYear + ' Earnings' : ''
        };
        var amounts = {
          day: earnings.day,
          month: selectedMonth !== null && selectedYear !== null ? earnings.custom : earnings.month,
          year: selectedYear !== null && selectedMonth === null ? earnings.custom : earnings.year,
          total: earnings.total,
          custom: earnings.custom
        };
        
        // Determine which amount to show based on current period and selections
        var currentLabel = labels[currentEarningsPeriod] || labels.total;
        var currentAmount = amounts.total;
        var showEarningsCard = true;
        
        if (currentEarningsPeriod === 'day') {
          currentAmount = amounts.day;
        } else if (currentEarningsPeriod === 'month') {
          currentAmount = selectedMonth !== null && selectedYear !== null ? amounts.custom : amounts.month;
          if (selectedMonth !== null && selectedYear !== null) {
            currentLabel = labels.custom;
          }
        } else if (currentEarningsPeriod === 'year') {
          currentAmount = selectedYear !== null && selectedMonth === null ? amounts.custom : amounts.year;
          if (selectedYear !== null && selectedMonth === null) {
            currentLabel = labels.year;
          }
        } else if (currentEarningsPeriod === 'total') {
          currentAmount = amounts.total;
        } else if (currentEarningsPeriod === 'categorize') {
          // For categorize, show earnings if month/year is selected
          if (selectedMonth !== null && selectedYear !== null) {
            currentAmount = amounts.custom;
            currentLabel = labels.custom;
            showEarningsCard = true;
          } else if (selectedYear !== null && selectedMonth === null) {
            currentAmount = amounts.custom;
            currentLabel = labels.year;
            showEarningsCard = true;
          } else {
            // No selection made yet, don't show earnings card
            showEarningsCard = false;
            currentLabel = 'Select Month & Year';
            currentAmount = 0;
          }
        }
        
        // Generate year options (starting from 2025)
        var currentYear = now.getFullYear();
        var yearOptions = '';
        var startYear = 2025;
        var endYear = Math.max(currentYear + 1, 2025);
        for (var y = startYear; y <= endYear; y++) {
          yearOptions += '<option value="' + y + '"' + (selectedYear === y ? ' selected' : '') + '>' + y + '</option>';
        }
        
        // Generate month options
        var monthOptions = '<option value="">Select Month</option>';
        monthNames.forEach(function(name, index){
          monthOptions += '<option value="' + index + '"' + (selectedMonth === index ? ' selected' : '') + '>' + name + '</option>';
        });

        var accountBalance = getOwnerAccountBalance(user.id);
        var payoutMethods = getPayoutMethods(user.id);
        var defaultPayout = getDefaultPayoutMethod(user.id);
        var payoutMethodsHtml = '';
        if (payoutMethods.length > 0) {
          var defaultPayoutMethod = payoutMethods.find(function(p) { return p.is_default; }) || payoutMethods[0];
          payoutMethodsHtml = '<div style="background:#fff;padding:15px;border-radius:12px;margin-bottom:20px;border:2px solid #4caf50;box-shadow:0 2px 8px rgba(76,175,80,0.2);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
            '<div>' +
            '<div style="font-size:14px;color:#666;margin-bottom:5px;">🏦 Payout Method</div>' +
            '<div style="font-weight:600;color:#333;font-size:16px;">' + (defaultPayoutMethod.bank_name || 'Bank Account') + '</div>' +
            '<div style="font-size:12px;color:#999;margin-top:2px;">Account: ****' + (defaultPayoutMethod.account_number ? defaultPayoutMethod.account_number.slice(-4) : '') + '</div>' +
            '</div>' +
            '<button id="manage-payout-methods" style="padding:8px 16px;border:2px solid #4caf50;border-radius:8px;background:#fff;color:#4caf50;cursor:pointer;font-size:12px;font-weight:600;">Manage</button>' +
            '</div>' +
            '</div>';
        } else {
          payoutMethodsHtml = '<div style="background:#fff3cd;padding:15px;border-radius:12px;margin-bottom:20px;border:2px solid #ffc107;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<div>' +
            '<div style="font-size:14px;color:#856404;font-weight:600;margin-bottom:5px;">⚠️ No Payout Method</div>' +
            '<div style="font-size:12px;color:#856404;">Add a bank account to withdraw your earnings</div>' +
            '</div>' +
            '<button id="add-payout-method" style="padding:8px 16px;border:2px solid #ff6f61;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">Add Bank Account</button>' +
            '</div>' +
            '</div>';
        }
        
        statsEl.innerHTML = ''+
          '<div style="text-align:center;margin-bottom:30px;padding-bottom:20px;border-bottom:3px solid #ff6f61;">'+
            '<h2 style="color:#ff6f61;margin:0 0 15px 0;font-size:32px;font-weight:700;text-shadow:2px 2px 4px rgba(0,0,0,0.1);">📊 Orders & Earnings</h2>'+
            '<div style="background:linear-gradient(135deg, #4caf50 0%, #66bb6a 100%);padding:20px;border-radius:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(76,175,80,0.3);">'+
              '<div style="font-size:18px;color:rgba(255,255,255,0.9);margin-bottom:8px;font-weight:600;">💰 Account Balance</div>'+
              '<div style="font-size:36px;font-weight:800;color:#fff;text-shadow:2px 2px 4px rgba(0,0,0,0.2);">'+ formatYen(accountBalance) +'</div>'+
              '<div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:5px;">Total payments received from orders</div>' +
              (accountBalance > 0 ? '<div style="margin-top:15px;"><button id="withdraw-funds" style="padding:10px 20px;border:2px solid rgba(255,255,255,0.8);border-radius:8px;background:rgba(255,255,255,0.2);color:#fff;cursor:pointer;font-size:14px;font-weight:600;backdrop-filter:blur(10px);">💸 Withdraw Funds</button></div>' : '') +
            '</div>'+
            payoutMethodsHtml +
            '<button id="pgRefreshOrders" style="padding:10px 20px;border:2px solid #ff6f61;border-radius:8px;background:linear-gradient(135deg, #ff6f61 0%, #ff8a80 100%);color:#fff;cursor:pointer;font-size:14px;font-weight:600;box-shadow:0 4px 8px rgba(255,111,97,0.3);transition:all 0.3s;">🔄 Refresh Orders</button>'+
          '</div>'+
          '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:30px;">'+
            '<div style="flex:1;min-width:300px;background:linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%);border:2px solid #ff6f61;border-radius:15px;padding:20px;box-shadow:0 6px 20px rgba(255,111,97,0.15);">'+
              '<div style="text-align:center;margin-bottom:15px;">'+
                '<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:15px;">'+
                  '<button id="pgEarnDay" class="pgEarnBtn" data-period="day" style="padding:8px 16px;border:2px solid #ff6f61;border-radius:8px;background:#fff;color:#ff6f61;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.3s;">📅 Today</button>'+
                  '<button id="pgEarnTotal" class="pgEarnBtn" data-period="total" style="padding:8px 16px;border:2px solid #ff6f61;border-radius:8px;background:#fff;color:#ff6f61;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.3s;">💰 Total</button>'+
                  '<button id="pgEarnCategorize" class="pgEarnBtn" data-period="categorize" style="padding:8px 16px;border:2px solid #ff6f61;border-radius:8px;background:#fff;color:#ff6f61;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.3s;">🔍 Categorize</button>'+
                '</div>'+
                '<div id="pgFilterContainer" style="display:' + (currentEarningsPeriod === 'categorize' ? 'flex' : 'none') + ';justify-content:center;gap:10px;flex-wrap:wrap;margin-bottom:15px;align-items:center;">'+
                  '<label style="font-weight:600;color:#333;font-size:14px;">Select Month:</label>'+
                  '<select id="pgSelectMonth" style="padding:8px 12px;border:2px solid #ddd;border-radius:8px;font-size:14px;min-width:150px;cursor:pointer;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+ monthOptions +'</select>'+
                  '<label style="font-weight:600;color:#333;font-size:14px;">Select Year:</label>'+
                  '<select id="pgSelectYear" style="padding:8px 12px;border:2px solid #ddd;border-radius:8px;font-size:14px;min-width:100px;cursor:pointer;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+ yearOptions +'</select>'+
                  '<button id="pgApplyCustom" style="padding:8px 16px;border:2px solid #ff6f61;border-radius:8px;background:linear-gradient(135deg, #ff6f61 0%, #ff8a80 100%);color:#fff;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.3s;">Apply</button>'+
                '</div>'+
                (showEarningsCard ? (
                '<div id="pgEarnLabel" style="font-size:14px;color:#666;margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:1px;line-height:1.4;">'+ currentLabel +'</div>'+
                '<div id="pgEarnAmount" style="font-size:36px;font-weight:800;color:#ff6f61;text-shadow:2px 2px 4px rgba(0,0,0,0.1);">'+ formatYen(currentAmount) +'</div>'
                ) : '')+
              '</div>'+
            '</div>'+
            '<div style="flex:1;min-width:300px;">'+
              '<h3 style="color:#ff6f61;margin-bottom:15px;text-align:center;font-size:20px;font-weight:700;padding:10px;background:linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%);border-radius:10px;box-shadow:0 2px 8px rgba(255,111,97,0.1);">🔄 Ongoing Orders</h3>'+
              '<div id="pgOngoingOrders" style="background:#fff;border:2px solid #ff6f61;border-radius:12px;padding:15px;max-height:400px;overflow-y:auto;box-shadow:0 4px 12px rgba(255,111,97,0.1);">'+
              (ongoingOrders.length > 0 ? ongoingOrders.map(function(oo){
                var customer = findUserById(oo.order.user_id);
                var customerName = customer ? (customer.name || customer.email || 'Unknown') : 'Unknown Customer';
                var customerPhoto = customer ? (customer.photo_url || null) : null;
                var customerAddress = oo.location || 'Address not provided';
                var itemsList = (oo.order.items || []).map(function(item){
                  var menu = getStorage(STORAGE_MENU_ITEMS, []).find(function(m){ return m.id === item.menu_item_id; });
                  if (menu) {
                    var rest = getRestaurantById(menu.restaurant_id);
                    if (rest && getOwnerRestaurantIds().indexOf(rest.id) !== -1) {
                      return item.name + ' x' + item.quantity;
                    }
                  }
                  return null;
                }).filter(function(x){ return x; }).join(', ');
                var orderStatus = oo.order.status || 'pending';
                var statusOptions = '';
                if (orderStatus === 'pending') {
                  statusOptions = '<button class="update-order-status" data-order-id="' + oo.order.id + '" data-status="confirmed" style="padding:6px 12px;border-radius:6px;border:none;background:#2196f3;color:white;cursor:pointer;font-size:11px;margin-right:5px;">✓ Confirm</button>' +
                    '<button class="update-order-status" data-order-id="' + oo.order.id + '" data-status="cancelled" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:11px;">✗ Cancel</button>';
                } else if (orderStatus === 'confirmed') {
                  statusOptions = '<button class="update-order-status" data-order-id="' + oo.order.id + '" data-status="delivered" style="padding:6px 12px;border-radius:6px;border:none;background:#4caf50;color:white;cursor:pointer;font-size:11px;margin-right:5px;">✓ Mark Delivered</button>' +
                    '<button class="update-order-status" data-order-id="' + oo.order.id + '" data-status="cancelled" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:11px;">✗ Cancel</button>';
                } else {
                  statusOptions = '<span style="padding:6px 12px;border-radius:6px;background:#e0e0e0;color:#666;font-size:11px;">' + orderStatus.toUpperCase() + '</span>';
                }
                return '<div style="padding:15px;margin-bottom:10px;border-left:4px solid #ff6f61;background:linear-gradient(135deg, #fffef0 0%, #fff9e6 100%);border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.05);">'+
                  '<div style="display:flex;gap:12px;align-items:start;margin-bottom:10px;">'+
                    '<div style="flex-shrink:0;">'+
                      (customerPhoto ? '<img src="'+customerPhoto+'" style="width:50px;height:50px;border-radius:50%;object-fit:cover;border:2px solid #ff6f61;box-shadow:0 2px 4px rgba(255,111,97,0.2);">' : '<div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg, #ff6f61 0%, #ff8a80 100%);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:700;border:2px solid #ff6f61;box-shadow:0 2px 4px rgba(255,111,97,0.2);">'+(customerName.charAt(0).toUpperCase())+'</div>')+
                    '</div>'+
                    '<div style="flex:1;">'+
                      '<div style="font-size:15px;font-weight:700;color:#333;margin-bottom:4px;">'+ customerName +'</div>'+
                      '<div style="font-size:12px;color:#666;margin-bottom:6px;"><span style="color:#ff6f61;">📍</span> <strong>'+ (oo.order.address || customerAddress) +'</strong></div>'+
                      '<div style="font-size:12px;color:#555;margin-bottom:6px;"><span style="color:#ff6f61;">🍽️</span> '+ (itemsList || 'N/A') +'</div>'+
                      (oo.order.estimated_delivery_time ? '<div style="font-size:11px;color:#1976d2;margin-bottom:4px;"><span style="color:#1976d2;">⏱️</span> Estimated: ' + oo.order.estimated_delivery_time + ' minutes</div>' : '')+
                    '</div>'+
                    '<div style="flex-shrink:0;text-align:right;">'+
                      '<div style="color:#ff6f61;font-weight:700;font-size:16px;margin-bottom:4px;">'+ formatYen(oo.total) +'</div>'+
                      '<div style="font-size:10px;color:#999;margin-bottom:8px;">Order #'+ oo.order.id +'</div>'+
                      '<div style="margin-top:8px;">'+statusOptions+'</div>'+
                    '</div>'+
                  '</div>'+
                  '<div style="font-size:10px;color:#999;margin-top:8px;padding-top:8px;border-top:1px solid #eee;">📅 '+ formatDate(oo.order.created_at) +' · Status: <span style="color:#ff6f61;font-weight:600;">' + orderStatus.toUpperCase() + '</span></div>'+
                '</div>';
              }).join('') : '<div style="padding:30px;text-align:center;color:#999;font-size:14px;background:#f9f9f9;border-radius:8px;">📭 No ongoing orders</div>')+
              '</div>'+
            '</div>'+
            '<div style="flex:1;min-width:300px;">'+
              '<h3 style="color:#ff6f61;margin-bottom:15px;text-align:center;font-size:20px;font-weight:700;padding:10px;background:linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%);border-radius:10px;box-shadow:0 2px 8px rgba(255,111,97,0.1);">📋 Total Orders ('+ allOrders.length +')</h3>'+
              '<div id="pgTotalOrders" style="background:#fff;border:2px solid #ff6f61;border-radius:12px;padding:15px;max-height:400px;overflow-y:auto;box-shadow:0 4px 12px rgba(255,111,97,0.1);">'+
              (allOrders.length > 0 ? allOrders.map(function(oo){
                var customer = findUserById(oo.order.user_id);
                var customerName = customer ? (customer.name || customer.email || 'Unknown') : 'Unknown Customer';
                var customerPhoto = customer ? (customer.photo_url || null) : null;
                var customerAddress = oo.location || 'Address not provided';
                var itemsList = (oo.order.items || []).map(function(item){
                  var menu = getStorage(STORAGE_MENU_ITEMS, []).find(function(m){ return m.id === item.menu_item_id; });
                  if (menu) {
                    var rest = getRestaurantById(menu.restaurant_id);
                    if (rest && getOwnerRestaurantIds().indexOf(rest.id) !== -1) {
                      return item.name + ' x' + item.quantity + ' (¥' + (item.price || 0) + ' each)';
                    }
                  }
                  return null;
                }).filter(function(x){ return x; }).join(', ');
                var isPending = oo.order.status === 'pending';
                var borderColor = isPending ? '#ff6f61' : '#4caf50';
                var bgGradient = isPending ? 'linear-gradient(135deg, #fffef0 0%, #fff9e6 100%)' : 'linear-gradient(135deg, #f1f8f4 0%, #e8f5e9 100%)';
                var statusColor = isPending ? '#ff6f61' : '#4caf50';
                var statusIcon = isPending ? '🔄' : '✅';
                var orderStatus = oo.order.status || 'pending';
                var statusOptions = '';
                if (orderStatus === 'pending') {
                  statusOptions = '<button class="update-order-status" data-order-id="' + oo.order.id + '" data-status="confirmed" style="padding:6px 12px;border-radius:6px;border:none;background:#2196f3;color:white;cursor:pointer;font-size:11px;margin-right:5px;">✓ Confirm</button>' +
                    '<button class="update-order-status" data-order-id="' + oo.order.id + '" data-status="cancelled" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:11px;">✗ Cancel</button>';
                } else if (orderStatus === 'confirmed') {
                  statusOptions = '<button class="update-order-status" data-order-id="' + oo.order.id + '" data-status="delivered" style="padding:6px 12px;border-radius:6px;border:none;background:#4caf50;color:white;cursor:pointer;font-size:11px;margin-right:5px;">✓ Mark Delivered</button>' +
                    '<button class="update-order-status" data-order-id="' + oo.order.id + '" data-status="cancelled" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:11px;">✗ Cancel</button>';
                } else {
                  statusOptions = '<span style="padding:6px 12px;border-radius:6px;background:#e0e0e0;color:#666;font-size:11px;">' + orderStatus.toUpperCase() + '</span>';
                }
                return '<div style="padding:15px;margin-bottom:10px;border-left:4px solid '+borderColor+';background:'+bgGradient+';border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.05);">'+
                  '<div style="display:flex;gap:12px;align-items:start;margin-bottom:10px;">'+
                    '<div style="flex-shrink:0;">'+
                      (customerPhoto ? '<img src="'+customerPhoto+'" style="width:50px;height:50px;border-radius:50%;object-fit:cover;border:2px solid '+borderColor+';box-shadow:0 2px 4px rgba(0,0,0,0.1);">' : '<div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg, '+borderColor+' 0%, '+(isPending ? '#ff8a80' : '#66bb6a')+' 100%);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:700;border:2px solid '+borderColor+';box-shadow:0 2px 4px rgba(0,0,0,0.1);">'+(customerName.charAt(0).toUpperCase())+'</div>')+
                    '</div>'+
                    '<div style="flex:1;">'+
                      '<div style="font-size:15px;font-weight:700;color:#333;margin-bottom:4px;">'+ customerName +'</div>'+
                      '<div style="font-size:12px;color:#666;margin-bottom:6px;"><span style="color:'+borderColor+';">📍</span> <strong>'+ (oo.order.address || customerAddress) +'</strong></div>'+
                      '<div style="font-size:12px;color:#555;margin-bottom:6px;"><span style="color:'+borderColor+';">🍽️</span> '+ (itemsList || 'N/A') +'</div>'+
                      (oo.order.estimated_delivery_time ? '<div style="font-size:11px;color:#1976d2;margin-bottom:4px;"><span style="color:#1976d2;">⏱️</span> Estimated: ' + oo.order.estimated_delivery_time + ' minutes</div>' : '')+
                    '</div>'+
                    '<div style="flex-shrink:0;text-align:right;">'+
                      '<div style="color:'+borderColor+';font-weight:700;font-size:16px;margin-bottom:4px;">'+ formatYen(oo.total) +'</div>'+
                      '<div style="font-size:10px;color:#999;margin-bottom:8px;">Order #'+ oo.order.id +'</div>'+
                      '<div style="margin-top:8px;">'+statusOptions+'</div>'+
                    '</div>'+
                  '</div>'+
                  '<div style="font-size:10px;color:#999;margin-top:8px;padding-top:8px;border-top:1px solid #eee;">📅 '+ formatDate(oo.order.created_at) +' · Status: <span style="color:'+statusColor+';font-weight:600;">'+statusIcon+' '+ (oo.order.status || 'completed') +'</span></div>'+
                '</div>';
              }).join('') : '<div style="padding:30px;text-align:center;color:#999;font-size:14px;background:#f9f9f9;border-radius:8px;">📭 No orders yet</div>')+
              '</div>'+
            '</div>'+
          '</div>';
      }

      var restaurants = getRestaurants().filter(function(r){ return r.owner_id === user.id; });

      function deleteRestaurant(restId) {
        var all = getRestaurants();
        all = all.filter(function(r){ return r.id !== restId; });
        setStorage(STORAGE_RESTAURANTS, all);
        var allItems = getStorage(STORAGE_MENU_ITEMS, []);
        allItems = allItems.filter(function(it){ return it.restaurant_id !== restId; });
        setStorage(STORAGE_MENU_ITEMS, allItems);
      }

      function updateRestaurant(rest) {
        var all = getRestaurants();
        var idx = all.findIndex(function(r){ return r.id === rest.id; });
        if (idx >= 0) { all[idx] = rest; } else { all.push(rest); }
        setStorage(STORAGE_RESTAURANTS, all);
        return rest;
      }

      function renderList() {
        var rows = restaurants.map(function(r){
          var menuItems = getMenuItems(r.id);
          var menuSectionId = 'menuSection_' + r.id;
          return '<div class="restaurant-item" data-rest-id="'+r.id+'" style="margin-bottom:15px;background:linear-gradient(135deg, #fff 0%, #f9f9f9 100%);border:2px solid #eee;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);overflow:hidden;">' +
            '<div style="display:flex;align-items:center;gap:15px;padding:15px;">' +
            (r.image_url ? '<img src="'+r.image_url+'" style="width:60px;height:60px;border-radius:10px;object-fit:cover;border:2px solid #eee;">' : '<div style="width:60px;height:60px;border-radius:10px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:24px;">🍽️</div>') +
            '<div style="flex:1;">'+
            '<div style="font-weight:700;font-size:18px;color:#333;margin-bottom:5px;">'+ (r.name || '') +'</div>'+ 
            '<div style="font-size:13px;color:#666;margin-bottom:3px;"><span style="color:#ff6f61;">📍</span> '+ (r.area||'-') +' · <span style="color:#ff6f61;">🍴</span> '+ (r.cuisine||'-') +' · <span style="color:#ff6f61;">💰</span> '+ (function(){ var pl = (r.price_level||'¥'); if(pl==='$')return'¥';if(pl==='$$')return'¥¥';if(pl==='$$$')return'¥¥¥';return pl;})() +'</div>'+ 
            (r.link ? '<div style="font-size:12px;color:#999;"><span style="color:#ff6f61;">🔗</span> '+ r.link +'</div>' : '') +
            '</div>'+
            '<button class="mmOwnerEdit" data-id="'+r.id+'" style="padding:10px 16px;border:2px solid #ff6f61;border-radius:8px;background:#fff;color:#ff6f61;cursor:pointer;font-weight:600;transition:all 0.3s;font-size:13px;" onmouseover="this.style.background=\'#ff6f61\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'#fff\';this.style.color=\'#ff6f61\'">✏️ Edit</button>'+
            '<button class="mmOwnerManageMenu" data-id="'+r.id+'" style="padding:10px 16px;border:2px solid #4caf50;border-radius:8px;background:#fff;color:#4caf50;cursor:pointer;font-weight:600;transition:all 0.3s;font-size:13px;" onmouseover="this.style.background=\'#4caf50\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'#fff\';this.style.color=\'#4caf50\'">📝 Menu</button>'+
            '<button class="mmOwnerDel" data-id="'+r.id+'" style="padding:10px 16px;border:2px solid #dc3545;border-radius:8px;background:#fff;color:#dc3545;cursor:pointer;font-weight:600;transition:all 0.3s;font-size:13px;" onmouseover="this.style.background=\'#dc3545\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'#fff\';this.style.color=\'#dc3545\'">🗑️ Delete</button>'+
            '</div>'+
            '<div id="'+menuSectionId+'" class="menu-section" data-rest-id="'+r.id+'" style="display:none;padding:20px;background:#f9f9f9;border-top:2px solid #eee;">'+
            '</div>'+
          '</div>';
        }).join('');
        return rows || '<div style="padding:30px;text-align:center;color:#999;font-size:16px;background:#f9f9f9;border-radius:10px;">📭 No restaurants yet. Add your first restaurant above!</div>';
      }
      
      function renderMenuSection(restId) {
        var menuSection = wrapper.querySelector('#menuSection_' + restId);
        if (!menuSection) return;
        var items = getMenuItems(restId);
        var rest = getRestaurants().find(function(r){ return r.id === restId; });
        var restName = rest ? rest.name : 'Restaurant';
        
        menuSection.innerHTML = '<div style="margin-bottom:15px;">'+
          '<h4 style="color:#ff6f61;margin:0 0 12px 0;font-size:18px;font-weight:700;">📝 Menu Items for '+restName+'</h4>'+
          '<div id="menuList_'+restId+'" style="margin-bottom:15px;background:#fff;padding:12px;border-radius:10px;border:2px solid #eee;max-height:300px;overflow-y:auto;">'+
            (items.length > 0 ? items.map(function(it){
              var priceDisplay = '';
              if (it.old_price && it.old_price > it.price) {
                var discountPercent = Math.round(((it.old_price - it.price) / it.old_price) * 100);
                priceDisplay = '<div style="text-align:right;"><div style="font-size:16px;font-weight:700;color:#ff6f61;">¥'+ (it.price||0).toFixed(0) +'</div><div style="font-size:12px;color:#999;text-decoration:line-through;">¥'+ (it.old_price||0).toFixed(0) +'</div><div style="font-size:11px;color:#4caf50;font-weight:600;">'+ discountPercent +'% Off</div></div>';
              } else {
                priceDisplay = '<div style="font-size:16px;font-weight:700;color:#ff6f61;">¥'+ (it.price||0).toFixed(0) +'</div>';
              }
              return '<div style="display:flex;align-items:center;gap:10px;padding:10px;margin-bottom:8px;background:linear-gradient(135deg, #fff 0%, #fafafa 100%);border:1px solid #ddd;border-radius:8px;">'+
                (it.image_url ? '<img src="'+it.image_url+'" style="width:50px;height:50px;border-radius:8px;object-fit:cover;">' : '<div style="width:50px;height:50px;border-radius:8px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;">🍽️</div>')+
                '<div style="flex:1;font-size:14px;font-weight:600;color:#333;">'+ it.name +'</div>'+
                priceDisplay +
                '<button class="mmMenuEdit" data-id="'+it.id+'" data-rest-id="'+restId+'" style="padding:8px 12px;border:2px solid #ff6f61;border-radius:8px;background:#fff;color:#ff6f61;cursor:pointer;font-weight:600;font-size:12px;transition:all 0.3s;" onmouseover="this.style.background=\'#ff6f61\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'#fff\';this.style.color=\'#ff6f61\'">✏️ Edit</button>'+
                '<button class="mmMenuDel" data-id="'+it.id+'" data-rest-id="'+restId+'" style="padding:8px 12px;border:2px solid #dc3545;border-radius:8px;background:#fff;color:#dc3545;cursor:pointer;font-weight:600;font-size:12px;transition:all 0.3s;" onmouseover="this.style.background=\'#dc3545\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'#fff\';this.style.color=\'#dc3545\'">🗑️ Delete</button>'+
              '</div>';
            }).join('') : '<div style="padding:20px;text-align:center;color:#999;font-size:14px;">No menu items yet. Add items below.</div>')+
          '</div>'+
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'+
            '<input id="menuName_'+restId+'" placeholder="Item name" style="grid-column:1/3;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
            '<input id="menuOriginalPrice_'+restId+'" type="number" step="0.01" placeholder="Original Price (¥)" style="padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
            '<input id="menuPrice_'+restId+'" type="number" step="0.01" placeholder="Discount Price (¥)" style="padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
            '<input id="menuImage_'+restId+'" type="file" accept="image/*" style="grid-column:1/3;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
          '</div>'+
          '<div id="menuError_'+restId+'" style="color:#b00020;min-height:1.2em;margin-bottom:8px;text-align:center;font-weight:600;font-size:13px;"></div>'+
          '<div style="display:flex;gap:10px;justify-content:center;">'+
            '<button class="mmMenuAdd" data-rest-id="'+restId+'" style="padding:10px 20px;border:none;border-radius:8px;background:linear-gradient(135deg, #4caf50 0%, #66bb6a 100%);color:#fff;cursor:pointer;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(76,175,80,0.3);transition:all 0.3s;">➕ Add Menu Item</button>'+
          '</div>'+
        '</div>';
        
        // Bind menu item handlers
        bindMenuHandlers(restId);
      }
      
      function bindMenuHandlers(restId) {
        var menuSection = wrapper.querySelector('#menuSection_' + restId);
        if (!menuSection) return;
        
        // Delete handler
        Array.prototype.forEach.call(menuSection.querySelectorAll('.mmMenuDel'), function(btn){
          btn.onclick = function(){
            var id = btn.getAttribute('data-id');
            var ok = true; try { ok = confirm('Delete this menu item?'); } catch(_) {}
            if (!ok) return;
            deleteMenuItem(id);
            renderMenuSection(restId);
            renderStatsWithHandlers();
          };
        });
        
        // Edit handler
        Array.prototype.forEach.call(menuSection.querySelectorAll('.mmMenuEdit'), function(btn){
          btn.onclick = function(){
            var id = btn.getAttribute('data-id');
            var all = getStorage(STORAGE_MENU_ITEMS, []);
            var it = all.find(function(x){ return x.id === id; });
            if (!it) return;
            var m = document.createElement('div'); m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1003;display:flex;align-items:center;justify-content:center;';
            var b = document.createElement('div'); b.style.cssText='background:#fff;padding:20px;border-radius:10px;max-width:500px;width:95%;';
            b.innerHTML = '<h3 style="color:#ff6f61;margin-bottom:10px;">Edit Menu Item</h3>'+
              '<input id="mmItemName" value="'+(it.name||'')+'" placeholder="Name" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">'+
              '<input id="mmItemOriginalPrice" type="number" step="0.01" value="'+(it.old_price||'')+'" placeholder="Original Price (¥)" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">'+
              '<input id="mmItemPrice" type="number" step="0.01" value="'+(it.price||0)+'" placeholder="Discount Price (¥)" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">'+
              '<input id="mmItemImage" type="file" accept="image/*" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">'+
              '<div style="display:flex;gap:10px;justify-content:flex-end;">'+
              '<button id="mmItemCancel" style="padding:10px 16px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">Cancel</button>'+
              '<button id="mmItemSave" style="padding:10px 16px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;">Save</button>'+
              '</div>';
            m.appendChild(b); document.body.appendChild(m);
            b.querySelector('#mmItemCancel').onclick = function(){ document.body.removeChild(m); };
            b.querySelector('#mmItemSave').onclick = function(){
              var name = b.querySelector('#mmItemName').value.trim();
              var originalPrice = parseFloat(b.querySelector('#mmItemOriginalPrice').value||'0');
              var price = parseFloat(b.querySelector('#mmItemPrice').value||'0');
              var file = b.querySelector('#mmItemImage').files[0];
              if (isNaN(price) || price <= 0) { alert('Enter a valid discount price.'); return; }
              if (originalPrice > 0 && originalPrice <= price) { alert('Original price must be greater than discount price.'); return; }
              function finish(img){
                var all2 = getStorage(STORAGE_MENU_ITEMS, []);
                var idx = all2.findIndex(function(x){ return x.id === it.id; });
                if (idx >= 0) {
                  all2[idx] = { 
                    id: it.id, 
                    restaurant_id: it.restaurant_id, 
                    name: name||it.name, 
                    price: isNaN(price)?it.price:price, 
                    old_price: (originalPrice > 0 && originalPrice > price) ? originalPrice : null,
                    image_url: img!=null?img:it.image_url||null 
                  };
                }
                setStorage(STORAGE_MENU_ITEMS, all2);
                document.body.removeChild(m);
                renderMenuSection(restId);
                renderStatsWithHandlers();
              }
              if (file) { fileToBase64(file).then(function(b64){ finish(b64); }); } else { finish(null); }
            };
          };
        });
        
        // Add handler
        var addBtn = menuSection.querySelector('.mmMenuAdd');
        if (addBtn) {
          addBtn.onclick = function(){
            var nameEl = menuSection.querySelector('#menuName_'+restId);
            var originalPriceEl = menuSection.querySelector('#menuOriginalPrice_'+restId);
            var priceEl = menuSection.querySelector('#menuPrice_'+restId);
            var fileEl = menuSection.querySelector('#menuImage_'+restId);
            var errEl = menuSection.querySelector('#menuError_'+restId);
            var name = nameEl ? nameEl.value.trim() : '';
            var originalPrice = originalPriceEl ? parseFloat(originalPriceEl.value || '0') : 0;
            var price = priceEl ? parseFloat(priceEl.value || '0') : 0;
            var file = fileEl ? fileEl.files[0] : null;
            errEl.textContent = '';
            if (!name) { errEl.textContent = 'Item name is required.'; return; }
            if (isNaN(price) || price <= 0) { errEl.textContent = 'Enter a valid discount price.'; return; }
            if (originalPrice > 0 && originalPrice <= price) { errEl.textContent = 'Original price must be greater than discount price.'; return; }
            function saveItem(imageUrl){
              saveMenuItem({ 
                id: generateId(), 
                restaurant_id: restId, 
                name: name, 
                price: price, 
                old_price: (originalPrice > 0 && originalPrice > price) ? originalPrice : null,
                image_url: imageUrl || null 
              });
              if (nameEl) nameEl.value = '';
              if (originalPriceEl) originalPriceEl.value = '';
              if (priceEl) priceEl.value = '';
              if (fileEl) fileEl.value = '';
              renderMenuSection(restId);
              renderStatsWithHandlers();
            }
            if (file) {
              fileToBase64(file).then(function(b64){ saveItem(b64); }).catch(function(){ errEl.textContent='Image upload failed.'; });
            } else {
              saveItem(null);
            }
          };
        }
      }

      wrapper.innerHTML = '<div style="margin-top:30px;padding-top:30px;border-top:3px solid #ff6f61;">'+
        '<div style="text-align:center;margin-bottom:25px;padding:30px 20px;border-radius:15px;position:relative;overflow:hidden;background-image:url(./food2.jpg);background-size:cover;background-position:center;background-repeat:no-repeat;">'+
          '<div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(135deg, rgba(255,245,245,0.8) 0%, rgba(255,224,224,0.8) 100%);z-index:1;"></div>'+
          '<h2 style="position:relative;z-index:2;color:#ff6f61;margin:0 0 10px 0;font-size:32px;font-weight:700;text-shadow:2px 2px 4px rgba(255,255,255,0.9);">🍽️ Restaurant Management</h2>'+
          '<p style="position:relative;z-index:2;margin:0;color:#555;font-size:16px;font-weight:500;text-shadow:1px 1px 2px rgba(255,255,255,0.8);">Add your restaurants. They will appear on the Restaurants page.</p>'+
        '</div>'+
        '<div id="pgOwnerList" style="margin-bottom:20px;background:#f9f9f9;padding:15px;border-radius:12px;border:2px solid #eee;">'+ renderList() +'</div>'+
        '<div style="text-align:center;margin-bottom:20px;padding:15px;background:linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%);border-radius:10px;box-shadow:0 2px 8px rgba(255,111,97,0.1);">'+
          '<h3 style="color:#ff6f61;margin:0;font-size:24px;font-weight:700;">➕ Add New Restaurant</h3>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:15px;">'+
        '<input id="pgRestName" placeholder="Name" style="padding:12px;border:2px solid #ddd;border-radius:10px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
        '<input id="pgRestArea" placeholder="Area (e.g., Kamegawa)" style="padding:12px;border:2px solid #ddd;border-radius:10px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
        '<select id="pgRestCuisine" style="padding:12px;border:2px solid #ddd;border-radius:10px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
        '<option value="">Select Cuisine</option>'+
        '<option value="Japanese">Japanese</option>'+
        '<option value="Chinese">Chinese</option>'+
        '<option value="Italian">Italian</option>'+
        '<option value="Other">Other</option>'+
        '</select>'+
        '<select id="pgRestPrice" style="padding:12px;border:2px solid #ddd;border-radius:10px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
        '<option value="¥">¥</option><option value="¥¥">¥¥</option><option value="¥¥¥">¥¥¥</option></select>'+
        '<label style="grid-column:1/3;display:flex;align-items:center;gap:8px;padding:8px;"><input type="checkbox" id="pgRestHalal" style="width:18px;height:18px;"> Halal certified</label>'+
        '<input id="pgRestLink" placeholder="Optional page link (e.g., ./myrest.html)" style="grid-column:1/3;padding:12px;border:2px solid #ddd;border-radius:10px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
        '<input id="pgRestImage" type="file" accept="image/*" style="grid-column:1/3;padding:12px;border:2px solid #ddd;border-radius:10px;font-size:14px;transition:border-color 0.3s;" onfocus="this.style.borderColor=\'#ff6f61\'" onblur="this.style.borderColor=\'#ddd\'">'+
        '</div>'+
        '<div id="pgOwnerError" style="color:#b00020;min-height:1.2em;margin-top:8px;text-align:center;font-weight:600;"></div>'+
        '<div style="display:flex;gap:10px;justify-content:center;margin-top:15px;">'+
        '<button id="pgOwnerAdd" style="padding:12px 24px;border:none;border-radius:10px;background:linear-gradient(135deg, #ff6f61 0%, #ff8a80 100%);color:#fff;cursor:pointer;font-size:16px;font-weight:600;box-shadow:0 4px 12px rgba(255,111,97,0.3);transition:all 0.3s;">➕ Add Restaurant</button>'+
        '</div></div>';

      // Create welcome message
      var welcomeEl = document.createElement('div');
      welcomeEl.style.cssText = 'text-align:center;margin-bottom:30px;padding:40px 25px;border-radius:15px;box-shadow:0 4px 12px rgba(255,111,97,0.15);border:2px solid #ff6f61;position:relative;overflow:hidden;background-image:url(./food.jpg);background-size:cover;background-position:center;background-repeat:no-repeat;';
      // Add overlay for better text readability
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(135deg, rgba(255,245,245,0.85) 0%, rgba(255,224,224,0.85) 100%);z-index:1;';
      welcomeEl.appendChild(overlay);
      var content = document.createElement('div');
      content.style.cssText = 'position:relative;z-index:2;';
      var userName = user.name || user.email || 'Owner';
      content.innerHTML = '<h1 style="color:#ff6f61;margin:0 0 10px 0;font-size:28px;font-weight:700;text-shadow:2px 2px 4px rgba(255,255,255,0.8);">👋 Welcome back, ' + userName + '!</h1>' +
        '<p style="margin:0;color:#555;font-size:16px;font-weight:500;text-shadow:1px 1px 2px rgba(255,255,255,0.8);">Manage your restaurants, view earnings, and track orders all in one place.</p>';
      welcomeEl.appendChild(content);

      container.innerHTML = '';
      container.appendChild(welcomeEl);
      container.appendChild(statsEl);
      container.appendChild(wrapper);
      
      // Function to attach refresh button handler
      function attachRefreshHandler() {
        var refreshBtn = statsEl.querySelector('#pgRefreshOrders');
        if (refreshBtn) {
          refreshBtn.onclick = function(){
            renderStatsWithHandlers();
          };
        }
      }
      
      // Add earnings period button handlers
      function attachEarningsHandlers() {
        var buttons = statsEl.querySelectorAll('.pgEarnBtn');
        buttons.forEach(function(btn){
          btn.onclick = function(){
            var period = this.getAttribute('data-period');
            currentEarningsPeriod = period;
            // Reset custom selection for day and total, and hide filters
            if (period === 'day' || period === 'total' || period === 'month' || period === 'year') {
              if (period === 'day' || period === 'total') {
                selectedMonth = null;
                selectedYear = null;
              }
              // Hide filters for day, total, month, year
              var filterContainer = statsEl.querySelector('#pgFilterContainer');
              if (filterContainer) {
                filterContainer.style.display = 'none';
              }
            } else if (period === 'categorize') {
              // Show filters for categorize
              var filterContainer = statsEl.querySelector('#pgFilterContainer');
              if (filterContainer) {
                filterContainer.style.display = 'flex';
              }
            }
            // Re-render stats to update the display
            renderStatsWithHandlers();
          };
        });
        
        // Apply custom month/year button
        var applyBtn = statsEl.querySelector('#pgApplyCustom');
        if (applyBtn) {
          applyBtn.onclick = function(){
            var monthSelect = statsEl.querySelector('#pgSelectMonth');
            var yearSelect = statsEl.querySelector('#pgSelectYear');
            var monthVal = monthSelect ? monthSelect.value : '';
            var yearVal = yearSelect ? yearSelect.value : '';
            
            if (monthVal !== '' && yearVal !== '') {
              selectedMonth = parseInt(monthVal);
              selectedYear = parseInt(yearVal);
              currentEarningsPeriod = 'month'; // Use month period for custom selection
              renderStatsWithHandlers();
            } else if (yearVal !== '' && monthVal === '') {
              selectedYear = parseInt(yearVal);
              selectedMonth = null;
              currentEarningsPeriod = 'year';
              renderStatsWithHandlers();
            } else {
              alert('Please select both month and year, or just year for yearly earnings.');
            }
          };
        }
        
        // Update filter container visibility on initial load
        var filterContainer = statsEl.querySelector('#pgFilterContainer');
        if (filterContainer) {
          filterContainer.style.display = (currentEarningsPeriod === 'categorize') ? 'flex' : 'none';
        }
        
        // Set initial active button based on current period
        var buttonIdMap = {
          day: 'pgEarnDay',
          month: 'pgEarnMonth',
          year: 'pgEarnYear',
          total: 'pgEarnTotal',
          categorize: 'pgEarnCategorize'
        };
        var activeBtnId = buttonIdMap[currentEarningsPeriod] || 'pgEarnTotal';
        var activeBtn = statsEl.querySelector('#' + activeBtnId);
        if (activeBtn) {
          activeBtn.style.background = 'linear-gradient(135deg, #ff6f61 0%, #ff8a80 100%)';
          activeBtn.style.color = '#fff';
        }
        
        // Update all button styles
        buttons.forEach(function(b){
          var btnPeriod = b.getAttribute('data-period');
          if (btnPeriod === currentEarningsPeriod) {
            b.style.background = 'linear-gradient(135deg, #ff6f61 0%, #ff8a80 100%)';
            b.style.color = '#fff';
          } else {
            b.style.background = '#fff';
            b.style.color = '#ff6f61';
          }
        });
      }
      
      // Attach order status update handlers
      function attachOrderStatusHandlers() {
        statsEl.querySelectorAll('.update-order-status').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var orderId = parseInt(btn.getAttribute('data-order-id'));
            var newStatus = btn.getAttribute('data-status');
            var statusText = newStatus === 'confirmed' ? 'confirm' : newStatus === 'delivered' ? 'mark as delivered' : 'cancel';
            if (confirm('Are you sure you want to ' + statusText + ' this order?')) {
              var allOrders = getStorage(STORAGE_ORDERS, []);
              var orderIndex = allOrders.findIndex(function(o) { return o.id === orderId; });
              if (orderIndex >= 0) {
                allOrders[orderIndex].status = newStatus;
                setStorage(STORAGE_ORDERS, allOrders);
                // Re-render stats to show updated status
                renderStatsWithHandlers();
              }
            }
          });
        });
      }

      // Wrapper function to render stats and re-attach handlers
      function renderStatsWithHandlers() {
        renderStats();
        attachRefreshHandler();
        attachEarningsHandlers();
        attachOrderStatusHandlers();
        
        // Re-attach payout method handlers after render
        var managePayoutBtn = statsEl.querySelector('#manage-payout-methods');
        if (managePayoutBtn) {
          managePayoutBtn.addEventListener('click', function() {
            showPayoutMethods();
          });
        }
        
        var addPayoutBtn = statsEl.querySelector('#add-payout-method');
        if (addPayoutBtn) {
          addPayoutBtn.addEventListener('click', function() {
            showAddEditPayoutMethod();
          });
        }
        
        var withdrawBtn = statsEl.querySelector('#withdraw-funds');
        if (withdrawBtn) {
          withdrawBtn.addEventListener('click', function() {
            showWithdrawFunds();
          });
        }
      }
      
      renderStatsWithHandlers();

      function refreshListOnly(){
        restaurants = getRestaurants().filter(function(r){ return r.owner_id === user.id; });
        var listEl = wrapper.querySelector('#pgOwnerList');
        // Store which menu sections were open
        var openMenus = {};
        restaurants.forEach(function(r){
          var menuSection = wrapper.querySelector('#menuSection_' + r.id);
          if (menuSection && menuSection.style.display !== 'none') {
            openMenus[r.id] = true;
          }
        });
        listEl.innerHTML = renderList();
        // Re-open menu sections that were open
        Object.keys(openMenus).forEach(function(restId){
          var menuSection = wrapper.querySelector('#menuSection_' + restId);
          if (menuSection) {
            menuSection.style.display = 'block';
            renderMenuSection(restId);
          }
        });
      }

      // Delegated handlers for edit/delete on restaurants
      wrapper.addEventListener('click', function(e){
        var delBtn = e.target.closest('.mmOwnerDel');
        if (delBtn) {
          e.preventDefault();
          var id = delBtn.getAttribute('data-id');
          var proceed = true; try { proceed = window.confirm('Delete this restaurant? This will also remove its menu items.'); } catch(_) {}
          if (!proceed) return;
          deleteRestaurant(id);
          refreshListOnly();
          renderStatsWithHandlers();
          try { initRestaurantFilters(); } catch(_) {}
          return;
        }
        var editBtn = e.target.closest('.mmOwnerEdit');
        if (editBtn) {
          e.preventDefault();
          var id2 = editBtn.getAttribute('data-id');
          var all = getRestaurants();
          var r = all.find(function(x){ return x.id === id2; });
          if (!r) return;
          var m = document.createElement('div'); m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1003;display:flex;align-items:center;justify-content:center;';
          var b = document.createElement('div'); b.style.cssText='background:#fff;padding:20px;border-radius:10px;max-width:600px;width:95%;';
          b.innerHTML = '<h3 style="color:#ff6f61;margin-bottom:10px;">Edit Restaurant</h3>'+
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'+
            '<input id="mmEditName" value="'+(r.name||'')+'" placeholder="Name" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
            '<input id="mmEditArea" value="'+(r.area||'')+'" placeholder="Area" style="padding:10px;border:1px solid #ccc;border-radius:8px;">'+
            '<select id="mmEditCuisine" style="padding:10px;border:1px solid #ccc;border-radius:8px;"><option value="">Select Cuisine</option><option value="Japanese">Japanese</option><option value="Chinese">Chinese</option><option value="Italian">Italian</option><option value="Other">Other</option></select>'+
            '<select id="mmEditPrice" style="padding:10px;border:1px solid #ccc;border-radius:8px;"><option value="¥">¥</option><option value="¥¥">¥¥</option><option value="¥¥¥">¥¥¥</option></select>'+
            '<label style="grid-column:1/3;display:flex;align-items:center;gap:8px;padding:8px;"><input type="checkbox" id="mmEditHalal" '+(r.halal?'checked':'')+' style="width:18px;height:18px;"> Halal certified</label>'+
            '<input id="mmEditLink" value="'+(r.link||'')+'" placeholder="Optional page link" style="grid-column:1/2;padding:10px;border:1px solid #ccc;border-radius:8px;">'+
            '<input id="mmEditImage" type="file" accept="image/*" style="grid-column:1/3;padding:10px;border:1px solid #ccc;border-radius:8px;">'+
            '</div>'+
            '<div id="mmEditErr" style="color:#b00020;min-height:1.2em;margin-top:8px;"></div>'+
            '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;">'+
            '<button id="mmEditCancel" style="padding:10px 16px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">Cancel</button>'+
            '<button id="mmEditSave" style="padding:10px 16px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;">Save</button>'+
            '</div>';
          m.appendChild(b); document.body.appendChild(m);
          var sel = b.querySelector('#mmEditPrice'); sel.value = r.price_level || '¥';
          var selCuisine = b.querySelector('#mmEditCuisine'); if (selCuisine) selCuisine.value = r.cuisine || '';
          b.querySelector('#mmEditCancel').onclick = function(){ document.body.removeChild(m); };
          b.querySelector('#mmEditSave').onclick = function(){
            var name = b.querySelector('#mmEditName').value.trim();
            var area = b.querySelector('#mmEditArea').value.trim();
            var cuisine = b.querySelector('#mmEditCuisine').value.trim();
            var price = b.querySelector('#mmEditPrice').value;
            var halal = b.querySelector('#mmEditHalal').checked;
            var link = b.querySelector('#mmEditLink').value.trim();
            var file = b.querySelector('#mmEditImage').files[0];
            var err = b.querySelector('#mmEditErr'); err.textContent = '';
            if (!name) { err.textContent = 'Name is required.'; return; }
            function finish(img){
              var updated = { id: r.id, owner_id: r.owner_id, name: name, area: area, cuisine: cuisine, price_level: price, halal: halal, image_url: (img!=null?img:r.image_url||null), link: link||null };
              updateRestaurant(updated);
              refreshListOnly();
              renderStatsWithHandlers();
              try { initRestaurantFilters(); } catch(_) {}
              document.body.removeChild(m);
            }
            if (file) { fileToBase64(file).then(function(b64){ finish(b64); }).catch(function(){ err.textContent='Image upload failed.'; }); }
            else { finish(null); }
          };
          return;
        }
        
        // Manage Menu button handler
        var manageMenuBtn = e.target.closest('.mmOwnerManageMenu');
        if (manageMenuBtn) {
          e.preventDefault();
          var restId = manageMenuBtn.getAttribute('data-id');
          var menuSection = wrapper.querySelector('#menuSection_' + restId);
          if (menuSection) {
            var isVisible = menuSection.style.display !== 'none';
            if (isVisible) {
              menuSection.style.display = 'none';
              manageMenuBtn.textContent = '📝 Menu';
            } else {
              menuSection.style.display = 'block';
              manageMenuBtn.textContent = '📝 Hide Menu';
              renderMenuSection(restId);
            }
          }
          return;
        }
      });

      function deleteMenuItem(itemId) {
        var allItems = getStorage(STORAGE_MENU_ITEMS, []);
        allItems = allItems.filter(function(i){ return i.id !== itemId; });
        setStorage(STORAGE_MENU_ITEMS, allItems);
      }

      refreshListOnly();

      wrapper.querySelector('#pgOwnerAdd').addEventListener('click', function(){
        var name = wrapper.querySelector('#pgRestName').value.trim();
        var area = wrapper.querySelector('#pgRestArea').value.trim();
        var cuisine = wrapper.querySelector('#pgRestCuisine').value.trim();
        var price = wrapper.querySelector('#pgRestPrice').value;
        var halal = wrapper.querySelector('#pgRestHalal').checked;
        var link = wrapper.querySelector('#pgRestLink').value.trim();
        var file = wrapper.querySelector('#pgRestImage').files[0];
        var err = wrapper.querySelector('#pgOwnerError');
        err.textContent = '';
        if (!name) { err.textContent = 'Name is required.'; return; }
        function saveWithImage(imageUrl){
          var restaurant = { id: generateId(), owner_id: user.id, name: name, area: area, cuisine: cuisine, price_level: price, halal: halal, image_url: imageUrl || null, link: link || null };
          saveRestaurant(restaurant);
          refreshListOnly();
          try { initRestaurantFilters(); } catch(e) {}
          renderStatsWithHandlers();
        }
        if (file) {
          fileToBase64(file).then(function(b64){ saveWithImage(b64); }).catch(function(){ err.textContent='Image upload failed.'; });
        } else {
          saveWithImage(null);
        }
      });
    } catch(e) { /* no-op */ }
  }

  // Initialize auth UI
  function initAuthUi() {
    var headerContainer = document.querySelector('header .container');
    if (!headerContainer) return;

    var loginBtn = headerContainer.querySelector('.login-btn');
    var user = getCurrentUser();

    if (user) {
      if (loginBtn) loginBtn.style.display = 'none';
      var existing = headerContainer.querySelector('.user-menu');
      if (existing) existing.remove();
      var orders = getUserOrders();
      var status = orders.length > 0 ? orders[0].status : null;
      headerContainer.appendChild(buildUserMenu(user.name || user.email, user.photo_url, status));

      // If owner, replace Restaurants tab with Owner Dashboard
      // If customer, add "My Orders & Savings" tab
      try {
        var nav = headerContainer.querySelector('nav');
        if (nav) {
          var links = Array.prototype.slice.call(nav.querySelectorAll('a'));
          var restLink = links.find(function(a){ return /res\.html$/i.test((a.getAttribute('href')||'')) || /Restaurants/i.test(a.textContent||''); });
          var ordersSavingsLink = links.find(function(a){ return /My Orders|Orders.*Savings/i.test(a.textContent||''); });
          
          if (user.role === 'owner') {
            if (restLink) {
              restLink.textContent = 'Owner Dashboard';
              restLink.setAttribute('href', './owner.html');
              restLink.onclick = null;
            }
            // Remove orders & savings link for owners
            if (ordersSavingsLink) {
              ordersSavingsLink.remove();
            }
          } else {
            // Non-owner: ensure Restaurants tab is restored
            if (restLink) {
              restLink.textContent = 'Restaurants';
              restLink.setAttribute('href', './res.html');
              restLink.onclick = null;
            }
            // Add "My Orders & Savings" tab for customers if it doesn't exist
            if (!ordersSavingsLink) {
              var ordersSavingsTab = document.createElement('a');
              ordersSavingsTab.href = './orders.html';
              ordersSavingsTab.textContent = 'My Orders & Savings';
              ordersSavingsTab.style.cssText = 'color: white; text-decoration: none; padding: 8px 16px; border-radius: 4px; transition: background 0.3s;';
              ordersSavingsTab.addEventListener('mouseenter', function() {
                this.style.background = 'rgba(255,255,255,0.2)';
              });
              ordersSavingsTab.addEventListener('mouseleave', function() {
                this.style.background = 'transparent';
              });
              // Insert before the last link (usually Contact or Login)
              if (nav.children.length > 0) {
                nav.insertBefore(ordersSavingsTab, nav.children[nav.children.length - 1]);
              } else {
                nav.appendChild(ordersSavingsTab);
              }
            }
          }
        }
      } catch(e) {}
      
      // Modify "Join Us" section for owners on home page, show "Today's Deal" for customers
      if (/index\.html$/i.test(location.pathname)) {
        try {
          var serviceBoxes = document.querySelectorAll('#services .service-boxes .box');
          if (serviceBoxes && serviceBoxes.length > 1) {
            var joinUsBox = serviceBoxes[1]; // Second box is "Join Us"
            var heading = joinUsBox.querySelector('h3');
            var paragraph = joinUsBox.querySelector('p');
            if (heading && paragraph) {
              if (user.role === 'owner') {
                heading.textContent = 'Help Students & Grow Your Business';
                paragraph.innerHTML = 'Join Meal Match to reach international students, reduce food waste, and expand your customer base. <a href="./owner.html" style="color:#ff6f61;font-weight:600;">Get started now!</a>';
              } else {
                // Show "Today's Deal" for customers
                heading.textContent = 'Today\'s Deal';
                paragraph.innerHTML = 'Check out the best deals available! <a href="./res.html" style="color:#ff6f61;font-weight:600;text-decoration:underline;">Click here!</a>';
              }
            }
          }
        } catch(e) {}
      }
    } else {
      var existingMenu = headerContainer.querySelector('.user-menu');
      if (existingMenu) existingMenu.remove();
      if (loginBtn) loginBtn.style.display = '';

      // Restore Restaurants tab when logged out
      try {
        var nav2 = headerContainer.querySelector('nav');
        if (nav2) {
          var links2 = Array.prototype.slice.call(nav2.querySelectorAll('a'));
          var restLink2 = links2.find(function(a){ return /Owner Dashboard/i.test(a.textContent||'') || /res\.html$/i.test((a.getAttribute('href')||'')); });
          if (restLink2) {
            restLink2.textContent = 'Restaurants';
            restLink2.setAttribute('href', './res.html');
            restLink2.onclick = null;
          }
        }
      } catch(e) {}
      
      // Update restaurant tab hero section when logged out (neutral for both customers and owners)
      if (/res\.html$/i.test(location.pathname)) {
        try {
          var heroSection = document.querySelector('section.hero');
          if (heroSection) {
            var heroH2 = heroSection.querySelector('h2');
            var heroP = heroSection.querySelector('p');
            if (heroH2 && heroP) {
              heroH2.textContent = 'Discover Great Restaurants';
              heroP.innerHTML = 'Browse amazing restaurants and delicious meals. Restaurant owners, <a href="./login.html" style="color:#ff6f61;font-weight:600;text-decoration:underline;">sign in to list your restaurant</a> and reach more customers!';
            }
          }
        } catch(e) {}
      }
      
      // Update "Today's Deal" content when logged out (neutral for both customers and owners)
      if (/index\.html$/i.test(location.pathname)) {
        try {
          var serviceBoxes2 = document.querySelectorAll('#services .service-boxes .box');
          if (serviceBoxes2 && serviceBoxes2.length > 1) {
            var joinUsBox2 = serviceBoxes2[1];
            var heading2 = joinUsBox2.querySelector('h3');
            var paragraph2 = joinUsBox2.querySelector('p');
            if (heading2 && paragraph2) {
              heading2.textContent = 'Special Offers';
              paragraph2.innerHTML = 'Discover amazing deals and discounts on meals! <a href="./login.html" style="color:#ff6f61;font-weight:600;text-decoration:underline;">Sign in to explore!</a>';
            }
          }
        } catch(e) {}
      }
    }
  }

  // Initialize login/signup forms
  function initLoginSignup() {
    var loginForm = document.getElementById('form-login');
    var signupForm = document.getElementById('form-signup');
    if (!loginForm && !signupForm) return;

    // Clear old localStorage on login page
    if (location.pathname.toLowerCase().endsWith('login.html')) {
      var existing = getCurrentUser();
      if (existing && existing.email) {
        // Already logged in, redirect unless on login page
        if (!location.pathname.toLowerCase().endsWith('login.html')) {
          window.location.href = 'index.html';
          return;
        }
      }
    }

    if (loginForm) {
      var newLoginForm = loginForm.cloneNode(true);
      loginForm.parentNode.replaceChild(newLoginForm, loginForm);
      loginForm = newLoginForm;
      var loginError = document.getElementById('login-error');
      loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var email = document.getElementById('login-email').value.trim().toLowerCase();
        var password = document.getElementById('login-password').value;
        loginError.textContent = '';

        if (!email || !password) {
          loginError.textContent = 'Please enter email and password.';
          return;
        }

        var user = findUserByEmail(email);
        if (!user || user.password !== password) {
          loginError.textContent = 'Invalid email or password.';
          return;
        }

        setCurrentUser(user);
        window.location.href = 'index.html';
      });
    }

    if (signupForm) {
      var newSignupForm = signupForm.cloneNode(true);
      signupForm.parentNode.replaceChild(newSignupForm, signupForm);
      signupForm = newSignupForm;

      // Inject role selector
      if (!document.getElementById('signup-role')) {
        var roleSel = document.createElement('select');
        roleSel.id = 'signup-role';
        roleSel.style.cssText = 'padding: 10px; width: 100%; border-radius: 8px; border: 1px solid #ccc; margin-bottom: 10px;';
        roleSel.innerHTML = '<option value="customer">Customer</option><option value="owner">Restaurant Owner</option>';
        signupForm.insertBefore(roleSel, signupForm.querySelector('input[id^="signup"]'));
      }

      // Inject photo input
      if (!document.getElementById('signup-photo')) {
        var photoIn = document.createElement('input');
        photoIn.type = 'file';
        photoIn.id = 'signup-photo';
        photoIn.accept = 'image/*';
        photoIn.style.cssText = 'padding: 10px; width: 100%; border-radius: 8px; border: 1px solid #ccc; margin-bottom: 10px;';
        var errorEl = document.getElementById('signup-error');
        if (errorEl) signupForm.insertBefore(photoIn, errorEl);
        else signupForm.appendChild(photoIn);
      }

      var signupError = document.getElementById('signup-error');
      var signupSuccess = document.getElementById('signup-success');
      signupForm.addEventListener('submit', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var name = document.getElementById('signup-name').value.trim();
        var email = document.getElementById('signup-email').value.trim().toLowerCase();
        var password = document.getElementById('signup-password').value;
        var confirm = document.getElementById('signup-confirm').value;
        var role = document.getElementById('signup-role').value;
        var photoFile = document.getElementById('signup-photo').files[0];
        signupError.textContent = '';
        signupSuccess.textContent = '';

        if (!name || !email || !password) {
          signupError.textContent = 'All fields are required.';
          return;
        }
        if (password.length < 6) {
          signupError.textContent = 'Password must be at least 6 characters.';
          return;
        }
        if (password !== confirm) {
          signupError.textContent = 'Passwords do not match.';
          return;
        }

        if (findUserByEmail(email)) {
          signupError.textContent = 'Email already registered.';
          return;
        }

        var newUser = {
          id: generateId(),
          name: name,
          email: email,
          password: password, // Plain text for demo (in real app, hash it)
          role: role,
          photo_url: null
        };

        if (photoFile) {
          fileToBase64(photoFile).then(function(base64) {
            newUser.photo_url = base64;
            saveUser(newUser);
            setCurrentUser(newUser);
            signupSuccess.textContent = 'Account created. Redirecting...';
            setTimeout(function() {
              window.location.href = 'index.html';
            }, 700);
          }).catch(function(err) {
            signupError.textContent = 'Error uploading photo.';
          });
        } else {
          saveUser(newUser);
          setCurrentUser(newUser);
          signupSuccess.textContent = 'Account created. Redirecting...';
          setTimeout(function() {
            window.location.href = 'index.html';
          }, 700);
        }
      });
    }
  }

  // Initialize ordering
  function initOrdering() {
    // Check if cart button already exists (might be created manually)
    var existingCartBtn = document.querySelector('button[style*="position:fixed"][style*="right:20px"]');
    
    var addButtons = document.querySelectorAll('.add-btn');
    
    // Simple cart stored per-restaurant path
    var CART_KEY = 'mm_cart_' + (location.pathname.split('/').pop() || 'page');
    function getCart() { return getStorage(CART_KEY, []); }
    function setCart(items) { setStorage(CART_KEY, items); }
    
    function updateCartButton() {
      var cart = getCart();
      var count = cart.reduce(function(sum, it){ return sum + (it.quantity || 1); }, 0);
      var cartBtn = existingCartBtn || document.querySelector('button[style*="position:fixed"][style*="right:20px"]');
      if (cartBtn) {
        cartBtn.textContent = 'View Cart (' + count + ')';
        cartBtn.style.display = count > 0 ? 'block' : 'none';
      }
    }
    
    if (!addButtons || !addButtons.length) {
      // Even if no add buttons, we should still set up cart button if it exists
      if (existingCartBtn) {
        // Remove any existing click handlers
        var newCartBtn = existingCartBtn.cloneNode(true);
        if (existingCartBtn.parentNode) {
          existingCartBtn.parentNode.replaceChild(newCartBtn, existingCartBtn);
        }
        existingCartBtn = newCartBtn;
        if (!existingCartBtn.parentNode) {
          document.body.appendChild(existingCartBtn);
        }
        // We'll attach the showCartModal handler below after it's defined
        updateCartButton();
      }
      // Don't return yet - we need to define showCartModal first
    }

    // Floating cart button - reuse existing one if it exists
    var cartBtn = existingCartBtn;
    if (!cartBtn) {
      cartBtn = document.createElement('button');
      cartBtn.textContent = 'View Cart (0)';
      cartBtn.style.cssText = 'position:fixed;right:20px;bottom:20px;background:#ff6f61;color:#fff;border:none;border-radius:24px;padding:12px 16px;box-shadow:0 6px 16px rgba(0,0,0,0.2);cursor:pointer;z-index:1000;display:none;';
      document.body.appendChild(cartBtn);
    } else {
      // Update existing button instead of replacing it
      // This preserves any existing handlers temporarily
      // We'll attach our handler below which will work alongside any existing ones
      // Ensure the button is in the DOM
      if (!cartBtn.parentNode) {
        document.body.appendChild(cartBtn);
      }
    }

    function updateCartButton() {
      var cart = getCart();
      var count = cart.reduce(function(sum, it){ return sum + it.quantity; }, 0);
      cartBtn.textContent = 'View Cart (' + count + ')';
      cartBtn.style.display = count > 0 ? 'block' : 'none';
    }

    function showCartModal() {
      var cart = getCart();
      if (!cart.length) return;
      var modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1001;display:flex;align-items:center;justify-content:center;';
      var box = document.createElement('div');
      box.style.cssText = 'background:#fff;padding:20px;border-radius:10px;max-width:500px;width:90%;max-height:80vh;overflow:auto;';
      var total = cart.reduce(function(sum, it){ return sum + it.price * it.quantity; }, 0);
      var totalSavings = cart.reduce(function(sum, it){ 
        var itemSavings = (it.old_price && it.old_price > it.price) ? (it.old_price - it.price) * it.quantity : 0;
        return sum + itemSavings;
      }, 0);
      var originalTotal = total + totalSavings;
      
      var listHtml = cart.map(function(it, index){ 
        var itemTotal = it.price * it.quantity;
        var itemSavings = (it.old_price && it.old_price > it.price) ? (it.old_price - it.price) * it.quantity : 0;
        var itemOriginalTotal = it.old_price ? it.old_price * it.quantity : itemTotal;
        var savingsHtml = itemSavings > 0 ? '<div style="font-size:11px;color:#4caf50;margin-top:2px;">💚 Saved: ¥' + itemSavings.toFixed(0) + '</div>' : '';
        var priceHtml = itemSavings > 0 ? '<div style="text-align:right;"><span style="text-decoration:line-through;color:#999;font-size:11px;">¥' + itemOriginalTotal.toFixed(0) + '</span><br><span style="color:#ff6f61;font-weight:600;">¥' + itemTotal.toFixed(0) + '</span></div>' : '<span>¥' + itemTotal.toFixed(0) + '</span>';
        return '<div class="cart-item" data-index="' + index + '" style="margin:8px 0;padding:12px;background:#f9f9f9;border-radius:6px;border:1px solid #eee;">'+
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">'+
          '<div style="flex:1;min-width:150px;"><span style="font-weight:600;font-size:14px;">'+it.name+'</span>'+savingsHtml+'</div>'+
          '<div style="display:flex;align-items:center;gap:8px;">'+
          '<button class="cart-qty-dec" data-index="' + index + '" style="width:28px;height:28px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;font-weight:600;color:#333;">-</button>'+
          '<span class="cart-qty-display" data-index="' + index + '" style="min-width:30px;text-align:center;font-weight:600;font-size:14px;">'+it.quantity+'</span>'+
          '<button class="cart-qty-inc" data-index="' + index + '" style="width:28px;height:28px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;font-weight:600;color:#333;">+</button>'+
          '</div>'+
          '<div style="text-align:right;min-width:80px;">'+priceHtml+'</div>'+
          '<button class="cart-remove-item" data-index="' + index + '" style="padding:6px 10px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:12px;margin-left:8px;">Remove</button>'+
          '</div></div>';
      }).join('');
      
      var savingsDisplay = totalSavings > 0 ? '<div style="display:flex;justify-content:space-between;margin-top:10px;padding:10px;background:#e8f5e9;border-radius:6px;"><span style="color:#2e7d32;font-weight:600;">💰 Total Savings:</span><span style="color:#2e7d32;font-weight:700;font-size:16px;">¥'+totalSavings.toFixed(0)+'</span></div>' : '';
      var originalTotalDisplay = totalSavings > 0 ? '<div style="display:flex;justify-content:space-between;margin-top:5px;font-size:13px;color:#999;"><span>Original Total:</span><span style="text-decoration:line-through;">¥'+originalTotal.toFixed(0)+'</span></div>' : '';
      
      // Get payment methods for selection
      var paymentMethods = getPaymentMethods();
      var defaultPayment = getDefaultPaymentMethod();
      var paymentMethodsHtml = '';
      if (paymentMethods.length > 0) {
        paymentMethodsHtml = '<div style="margin-top:20px;padding-top:15px;border-top:2px solid #eee;">' +
          '<label style="display:block;margin-bottom:8px;font-weight:600;color:#333;">💳 Payment Method <span style="color:#f44336;">*</span></label>' +
          '<select id="mmCartPaymentMethod" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;margin-bottom:10px;background:#fff;">' +
          paymentMethods.map(function(method) {
            var cardDisplay = method.nickname || (method.type.toUpperCase() + ' Card');
            var cardNumber = method.card_number ? ('**** ' + method.card_number.slice(-4)) : '';
            var selected = (defaultPayment && defaultPayment.id === method.id) ? ' selected' : '';
            return '<option value="' + method.id + '"' + selected + '>' + cardDisplay + ' ' + cardNumber + (method.is_default ? ' (Default)' : '') + '</option>';
          }).join('') +
          '</select>' +
          '<a href="#" id="manage-payment-methods" style="color:#ff6f61;font-size:13px;text-decoration:underline;display:block;margin-top:5px;">Manage Payment Methods</a>' +
          '</div>';
      } else {
        paymentMethodsHtml = '<div style="margin-top:20px;padding-top:15px;border-top:2px solid #eee;">' +
          '<label style="display:block;margin-bottom:8px;font-weight:600;color:#333;">💳 Payment Method <span style="color:#f44336;">*</span></label>' +
          '<div style="padding:15px;background:#fff3cd;border:2px solid #ffc107;border-radius:8px;margin-bottom:10px;">' +
          '<p style="margin:0;color:#856404;font-size:14px;">No payment methods saved. <a href="#" id="add-payment-method-link" style="color:#ff6f61;font-weight:600;text-decoration:underline;">Add a payment method</a> to continue.</p>' +
          '</div>' +
          '</div>';
      }

      box.innerHTML = '<h3 style="color:#ff6f61;margin-bottom:15px;">Your Cart</h3>'+
        '<div id="cart-items-list">'+ listHtml +'</div>'+
        '<div style="margin-top:15px;padding-top:15px;border-top:2px solid #eee;">'+
        '<div id="cart-original-total">'+originalTotalDisplay+'</div>'+
        '<div style="display:flex;justify-content:space-between;margin-top:10px;font-weight:700;font-size:18px;"><span>Total</span><span id="cart-total" style="color:#ff6f61;">¥'+total.toFixed(0)+'</span></div>'+
        '<div id="cart-savings">'+savingsDisplay+'</div>'+
        '</div>'+
        '<div style="margin-top:20px;padding-top:15px;border-top:2px solid #eee;">'+
        '<label style="display:block;margin-bottom:8px;font-weight:600;color:#333;">Delivery Address <span style="color:#f44336;">*</span></label>'+
        '<div style="display:flex;gap:8px;margin-bottom:10px;">'+
        '<input type="text" id="mmCartAddress" placeholder="Enter your delivery address" style="flex:1;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;" required>'+
        '<button id="mmUseLocation" type="button" style="padding:10px 16px;border:2px solid #4caf50;border-radius:8px;background:#fff;color:#4caf50;cursor:pointer;font-weight:600;font-size:14px;white-space:nowrap;display:flex;align-items:center;gap:6px;" title="Use your current location">'+
        '<span>📍</span><span id="mmLocationText">Use Location</span>'+
        '</button>'+
        '</div>'+
        '<div id="mmLocationStatus" style="font-size:12px;color:#666;margin-bottom:8px;min-height:18px;"></div>'+
        '<div id="mmEstimatedTime" style="padding:10px;background:#e3f2fd;border-radius:8px;margin-top:10px;display:none;">'+
        '<strong style="color:#1976d2;">⏱️ Estimated Delivery Time: <span id="mmTimeValue">-</span> minutes</strong>'+
        '</div>'+
        '</div>'+
        paymentMethodsHtml +
        '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">'+
        '<button id="mmCartCancel" style="padding:10px 16px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">Close</button>'+
        '<button id="mmCartPlace" style="padding:10px 16px;border:none;border-radius:8px;background:#ff6f61;color:#fff;cursor:pointer;">Place Order</button>'+
        '</div>';
      modal.appendChild(box);
      document.body.appendChild(modal);

      var addressInput = box.querySelector('#mmCartAddress');
      var estimatedTimeDiv = box.querySelector('#mmEstimatedTime');
      var timeValue = box.querySelector('#mmTimeValue');
      var useLocationBtn = box.querySelector('#mmUseLocation');
      var locationStatus = box.querySelector('#mmLocationStatus');
      var locationText = box.querySelector('#mmLocationText');
      var currentCart = JSON.parse(JSON.stringify(cart)); // Clone cart for editing

      // Function to get address from coordinates using reverse geocoding
      function getAddressFromCoordinates(lat, lng) {
        // Using OpenStreetMap Nominatim API (free, no API key required)
        // For production, you can replace this with Google Maps Geocoding API if you have an API key
        var url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&zoom=18&addressdetails=1';
        
        locationStatus.innerHTML = '<span style="color:#1976d2;">🔄 Getting address...</span>';
        locationText.textContent = 'Getting...';
        useLocationBtn.disabled = true;
        useLocationBtn.style.opacity = '0.6';
        useLocationBtn.style.cursor = 'not-allowed';

        fetch(url)
          .then(function(response) {
            if (!response.ok) throw new Error('Geocoding failed');
            return response.json();
          })
          .then(function(data) {
            if (data && data.display_name) {
              var address = data.display_name;
              addressInput.value = address;
              addressInput.style.borderColor = '#4caf50';
              locationStatus.innerHTML = '<span style="color:#4caf50;">✅ Location found!</span>';
              
              // Trigger address input event to calculate estimated time
              var event = new Event('input', { bubbles: true });
              addressInput.dispatchEvent(event);
              
              // Reset button after 2 seconds
              setTimeout(function() {
                locationStatus.innerHTML = '';
                locationText.textContent = 'Use Location';
                useLocationBtn.disabled = false;
                useLocationBtn.style.opacity = '1';
                useLocationBtn.style.cursor = 'pointer';
              }, 2000);
            } else {
              throw new Error('No address found');
            }
          })
          .catch(function(error) {
            console.error('Geocoding error:', error);
            locationStatus.innerHTML = '<span style="color:#f44336;">❌ Could not get address. Please enter manually.</span>';
            locationText.textContent = 'Use Location';
            useLocationBtn.disabled = false;
            useLocationBtn.style.opacity = '1';
            useLocationBtn.style.cursor = 'pointer';
          });
      }

      // Function to get current location
      function getCurrentLocation() {
        if (!navigator.geolocation) {
          alert('Geolocation is not supported by your browser. Please enter your address manually.');
          return;
        }

        locationStatus.innerHTML = '<span style="color:#1976d2;">📍 Getting your location...</span>';
        locationText.textContent = 'Locating...';
        useLocationBtn.disabled = true;
        useLocationBtn.style.opacity = '0.6';
        useLocationBtn.style.cursor = 'not-allowed';

        navigator.geolocation.getCurrentPosition(
          function(position) {
            var lat = position.coords.latitude;
            var lng = position.coords.longitude;
            getAddressFromCoordinates(lat, lng);
          },
          function(error) {
            var errorMsg = 'Could not get your location. ';
            switch(error.code) {
              case error.PERMISSION_DENIED:
                errorMsg += 'Please allow location access and try again.';
                break;
              case error.POSITION_UNAVAILABLE:
                errorMsg += 'Location information is unavailable.';
                break;
              case error.TIMEOUT:
                errorMsg += 'Location request timed out.';
                break;
              default:
                errorMsg += 'An unknown error occurred.';
                break;
            }
            locationStatus.innerHTML = '<span style="color:#f44336;">❌ ' + errorMsg + '</span>';
            locationText.textContent = 'Use Location';
            useLocationBtn.disabled = false;
            useLocationBtn.style.opacity = '1';
            useLocationBtn.style.cursor = 'pointer';
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          }
        );
      }

      // Attach location button handler
      if (useLocationBtn) {
        useLocationBtn.addEventListener('click', function() {
          getCurrentLocation();
        });
      }

      // Function to update cart display and totals
      function updateCartDisplay() {
        // Ensure we're working with the latest cart state
        if (currentCart.length === 0) {
          alert('Cart is empty. Closing cart.');
          setCart([]);
          updateCartButton();
          document.body.removeChild(modal);
          return;
        }
        
        var newTotal = currentCart.reduce(function(sum, it){ return sum + it.price * it.quantity; }, 0);
        var newTotalSavings = currentCart.reduce(function(sum, it){ 
          var itemSavings = (it.old_price && it.old_price > it.price) ? (it.old_price - it.price) * it.quantity : 0;
          return sum + itemSavings;
        }, 0);
        var newOriginalTotal = newTotal + newTotalSavings;
        
        var newListHtml = currentCart.map(function(it, index){ 
          var itemTotal = it.price * it.quantity;
          var itemSavings = (it.old_price && it.old_price > it.price) ? (it.old_price - it.price) * it.quantity : 0;
          var itemOriginalTotal = it.old_price ? it.old_price * it.quantity : itemTotal;
          var savingsHtml = itemSavings > 0 ? '<div style="font-size:11px;color:#4caf50;margin-top:2px;">💚 Saved: ¥' + itemSavings.toFixed(0) + '</div>' : '';
          var priceHtml = itemSavings > 0 ? '<div style="text-align:right;"><span style="text-decoration:line-through;color:#999;font-size:11px;">¥' + itemOriginalTotal.toFixed(0) + '</span><br><span style="color:#ff6f61;font-weight:600;">¥' + itemTotal.toFixed(0) + '</span></div>' : '<span>¥' + itemTotal.toFixed(0) + '</span>';
          return '<div class="cart-item" data-index="' + index + '" style="margin:8px 0;padding:12px;background:#f9f9f9;border-radius:6px;border:1px solid #eee;">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">'+
            '<div style="flex:1;min-width:150px;"><span style="font-weight:600;font-size:14px;">'+it.name+'</span>'+savingsHtml+'</div>'+
            '<div style="display:flex;align-items:center;gap:8px;">'+
            '<button class="cart-qty-dec" data-index="' + index + '" style="width:28px;height:28px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;font-weight:600;color:#333;">-</button>'+
            '<span class="cart-qty-display" data-index="' + index + '" style="min-width:30px;text-align:center;font-weight:600;font-size:14px;">'+it.quantity+'</span>'+
            '<button class="cart-qty-inc" data-index="' + index + '" style="width:28px;height:28px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;font-weight:600;color:#333;">+</button>'+
            '</div>'+
            '<div style="text-align:right;min-width:80px;">'+priceHtml+'</div>'+
            '<button class="cart-remove-item" data-index="' + index + '" style="padding:6px 10px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:12px;margin-left:8px;">Remove</button>'+
            '</div></div>';
        }).join('');
        
        box.querySelector('#cart-items-list').innerHTML = newListHtml;
        box.querySelector('#cart-total').textContent = '¥' + newTotal.toFixed(0);
        
        var newSavingsDisplay = newTotalSavings > 0 ? '<div style="display:flex;justify-content:space-between;margin-top:10px;padding:10px;background:#e8f5e9;border-radius:6px;"><span style="color:#2e7d32;font-weight:600;">💰 Total Savings:</span><span style="color:#2e7d32;font-weight:700;font-size:16px;">¥'+newTotalSavings.toFixed(0)+'</span></div>' : '';
        var newOriginalTotalDisplay = newTotalSavings > 0 ? '<div style="display:flex;justify-content:space-between;margin-top:5px;font-size:13px;color:#999;"><span>Original Total:</span><span style="text-decoration:line-through;">¥'+newOriginalTotal.toFixed(0)+'</span></div>' : '';
        box.querySelector('#cart-savings').innerHTML = newSavingsDisplay;
        box.querySelector('#cart-original-total').innerHTML = newOriginalTotalDisplay;
        
        // Save cart state
        setCart(currentCart);
        updateCartButton();
        
        // Re-attach event listeners
        attachCartListeners();
      }

      // Function to attach cart edit listeners
      function attachCartListeners() {
        box.querySelectorAll('.cart-qty-inc').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var index = parseInt(btn.getAttribute('data-index'));
            if (currentCart[index]) {
              currentCart[index].quantity += 1;
              box.querySelector('.cart-qty-display[data-index="' + index + '"]').textContent = currentCart[index].quantity;
              updateCartDisplay();
            }
          });
        });

        box.querySelectorAll('.cart-qty-dec').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var index = parseInt(btn.getAttribute('data-index'));
            if (currentCart[index]) {
              if (currentCart[index].quantity > 1) {
                currentCart[index].quantity -= 1;
                box.querySelector('.cart-qty-display[data-index="' + index + '"]').textContent = currentCart[index].quantity;
                updateCartDisplay();
              } else {
                // If quantity is 1, remove the item completely
                if (confirm('Remove ' + currentCart[index].name + ' from cart?')) {
                  currentCart.splice(index, 1);
                  // Save cart immediately
                  setCart(currentCart);
                  updateCartButton();
                  if (currentCart.length === 0) {
                    alert('Cart is empty. Closing cart.');
                    document.body.removeChild(modal);
                    return;
                  }
                  // Update display with new cart state
                  updateCartDisplay();
                }
              }
            }
          });
        });

        // Set up event delegation for remove buttons ONCE on the box
        // This works even when HTML is regenerated
        if (!box._removeHandlerAttached) {
          box.addEventListener('click', function(e) {
            // Check if the clicked element is a remove button or inside one
            var removeBtn = e.target;
            while (removeBtn && removeBtn !== box && !removeBtn.classList.contains('cart-remove-item')) {
              removeBtn = removeBtn.parentElement;
            }
            
            if (!removeBtn || removeBtn === box || !removeBtn.classList.contains('cart-remove-item')) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            var index = parseInt(removeBtn.getAttribute('data-index'));
            
            // Validate index
            if (isNaN(index) || index < 0 || index >= currentCart.length) {
              console.error('Invalid cart index:', index, 'Cart length:', currentCart.length);
              updateCartDisplay();
              return;
            }
            
            var item = currentCart[index];
            if (!item) {
              console.error('Item not found at index:', index);
              updateCartDisplay();
              return;
            }
            
            var itemName = item.name || 'item';
            if (confirm('Remove ' + itemName + ' from cart?')) {
              // Remove item from cart
              currentCart.splice(index, 1);
              
              // Save cart immediately
              setCart(currentCart);
              updateCartButton();
              
              if (currentCart.length === 0) {
                alert('Cart is empty. Closing cart.');
                if (modal && modal.parentNode) {
                  document.body.removeChild(modal);
                }
                return;
              }
              
              // Update display with new cart state (this will regenerate HTML with correct indices)
              updateCartDisplay();
            }
          });
          box._removeHandlerAttached = true; // Mark as attached to prevent duplicates
        }
      }

      // Attach initial listeners
      attachCartListeners();

      // Calculate estimated time when address is entered
      addressInput.addEventListener('input', function() {
        var address = addressInput.value.trim();
        if (address.length > 5) {
          var estimatedMinutes = calculateEstimatedTime(address);
          timeValue.textContent = estimatedMinutes;
          estimatedTimeDiv.style.display = 'block';
        } else {
          estimatedTimeDiv.style.display = 'none';
        }
      });

      box.querySelector('#mmCartCancel').onclick = function(){ 
        // Save cart changes when closing
        setCart(currentCart);
        updateCartButton();
        document.body.removeChild(modal); 
      };
      // Handle payment method management links
      var managePaymentLink = box.querySelector('#manage-payment-methods');
      if (managePaymentLink) {
        managePaymentLink.addEventListener('click', function(e) {
          e.preventDefault();
          document.body.removeChild(modal);
          showPaymentMethods();
        });
      }

      var addPaymentLink = box.querySelector('#add-payment-method-link');
      if (addPaymentLink) {
        addPaymentLink.addEventListener('click', function(e) {
          e.preventDefault();
          document.body.removeChild(modal);
          showAddEditPaymentMethod();
        });
      }

      // Attach Place Order button handler using addEventListener for better reliability
      var placeOrderBtn = box.querySelector('#mmCartPlace');
      if (placeOrderBtn) {
        // Remove any existing handlers by cloning the button
        var newPlaceOrderBtn = placeOrderBtn.cloneNode(true);
        if (placeOrderBtn.parentNode) {
          placeOrderBtn.parentNode.replaceChild(newPlaceOrderBtn, placeOrderBtn);
        }
        placeOrderBtn = newPlaceOrderBtn;
        
        placeOrderBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          var user = getCurrentUser(); 
          if (!user) { 
            window.location.href = 'login.html'; 
            return; 
          }
          
          var address = addressInput.value.trim();
          if (!address) {
            alert('Please enter a delivery address.');
            addressInput.focus();
            return;
          }
          
          // Check payment method - make it optional if no payment methods exist
          var paymentMethodSelect = box.querySelector('#mmCartPaymentMethod');
          var selectedPaymentMethodId = null;
          
          if (paymentMethodSelect && paymentMethodSelect.value) {
            selectedPaymentMethodId = paymentMethodSelect.value;
          } else if (paymentMethods.length > 0) {
            // If payment methods exist but none selected, require selection
            alert('Please select a payment method.');
            if (paymentMethodSelect) {
              paymentMethodSelect.focus();
            }
            return;
          }
          // If no payment methods exist at all, allow order to proceed without one
          
          var estimatedMinutes = calculateEstimatedTime(address);
          // Use currentCart (edited cart) instead of original cart
          setCart(currentCart);
          updateCartButton();
          var totalSavings = currentCart.reduce(function(sum, it){ 
            var itemSavings = (it.old_price && it.old_price > it.price) ? (it.old_price - it.price) * it.quantity : 0;
            return sum + itemSavings;
          }, 0);
          
          try {
            var order = createOrder(
              currentCart.map(function(it){ 
                var itemSavings = (it.old_price && it.old_price > it.price) ? (it.old_price - it.price) * it.quantity : 0;
                return { 
                  menu_item_id: it.id, 
                  restaurant_id: it.restaurant_id || null, // Store restaurant_id in order item for easier matching
                  name: it.name, 
                  quantity: it.quantity, 
                  price: it.price,
                  old_price: it.old_price || null,
                  savings: itemSavings
                }; 
              }),
              address,
              estimatedMinutes,
              totalSavings,
              selectedPaymentMethodId
            );
            setCart([]);
            updateCartButton();
            document.body.removeChild(modal);
            // Show order confirmation with tracking
            showOrderConfirmation(order);
            // Refresh user menu to show new order status
            initAuthUi();
          } catch (error) {
            console.error('Error placing order:', error);
            alert('An error occurred while placing your order. Please try again.');
          }
        });
      } else {
        console.error('Place Order button not found!');
      }
    }

    // Remove any existing click handlers and attach our handler
    // Clone the button to remove old handlers, but keep it in the same position
    var oldCartBtn = cartBtn;
    var newCartBtn = cartBtn.cloneNode(true);
    if (oldCartBtn.parentNode) {
      oldCartBtn.parentNode.replaceChild(newCartBtn, oldCartBtn);
    }
    cartBtn = newCartBtn;
    // Ensure it's in the DOM
    if (!cartBtn.parentNode) {
      document.body.appendChild(cartBtn);
    }
    // Update the button text and visibility
    updateCartButton();
    // Attach the click handler
    cartBtn.addEventListener('click', showCartModal);
    
    // If we had no add buttons but had an existing cart button, attach handler now
    if (!addButtons || !addButtons.length) {
      if (existingCartBtn && existingCartBtn !== cartBtn) {
        existingCartBtn.addEventListener('click', showCartModal);
      }
      // Return early since we don't need to set up add button handlers
      return;
    }

    addButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var user = getCurrentUser();
        if (!user) {
          window.location.href = 'login.html';
          return;
        }

        var itemEl = btn.closest('.menu-item');
        if (!itemEl) return;

        var nameEl = itemEl.querySelector('h3');
        var priceEl = itemEl.querySelector('.price');
        var oldPriceEl = itemEl.querySelector('.old-price');
        var name = nameEl ? nameEl.textContent.trim() : 'Item';
        var priceText = priceEl ? priceEl.textContent.trim() : '';
        var price = parseFloat(priceText.replace(/[^\d.]/g, '')) || 0;
        var oldPriceText = oldPriceEl ? oldPriceEl.textContent.trim() : '';
        var oldPrice = parseFloat(oldPriceText.replace(/[^\d.]/g, '')) || 0;
        var savings = oldPrice > price ? (oldPrice - price) : 0;

        // Find restaurant ID from current page (hardcoded for demo - can improve)
        var restaurantId = null;
        if (location.pathname.includes('lawson')) restaurantId = 'lawson';
        else if (location.pathname.includes('Gyomu')) restaurantId = 'gyomu';
        else if (location.pathname.includes('marushoku')) restaurantId = 'marushoku';

        // Create menu item if needed
        var existingItems = getMenuItems(restaurantId || 'unknown');
        var found = existingItems.find(function(i){ return i.name === name && i.price === price; });
        var menuItem = found || saveMenuItem({ id: generateId(), restaurant_id: restaurantId || 'unknown', name: name, price: price, old_price: oldPrice > 0 ? oldPrice : null, image_url: null });

        // Add to cart
        var cart = getCart();
        var cartIt = cart.find(function(ci){ return ci.id === menuItem.id; });
        if (cartIt) {
          cartIt.quantity += 1;
          if (savings > 0) {
            cartIt.old_price = oldPrice;
            cartIt.savings = savings;
          }
        } else {
          var cartItem = { id: menuItem.id, name: name, price: price, quantity: 1 };
          if (savings > 0) {
            cartItem.old_price = oldPrice;
            cartItem.savings = savings;
          }
          cart.push(cartItem);
        }
        setCart(cart);
        updateCartButton();

        btn.textContent = 'ADDED';
        setTimeout(function() { btn.textContent = 'ADD'; }, 800);
      });
    });

    updateCartButton();
  }

  // Initialize customer orders section on restaurant page (adds orders section but keeps restaurants)
  function initCustomerOrdersSection() {
    var user = getCurrentUser();
    if (!user || user.role === 'owner') return; // Only for customers

    var restaurantsSection = document.querySelector('#restaurants');
    if (!restaurantsSection) return;

    // Check if orders section already exists
    var existingOrdersSection = document.querySelector('#customer-orders');
    if (existingOrdersSection) return;

    // Add welcoming message between hero and search section for customers
    var heroSection = document.querySelector('section.hero');
    var searchSection = document.querySelector('section[style*="padding: 40px 20px"]');
    if (heroSection && searchSection) {
      var existingWelcome = document.querySelector('.customer-welcome-message');
      if (!existingWelcome) {
        // Create a wrapper section for the welcome message
        var welcomeSection = document.createElement('section');
        welcomeSection.className = 'customer-welcome-message';
        welcomeSection.style.cssText = 'padding: 30px 20px; background-color: #fff; text-align: center;';
        var welcomeContainer = document.createElement('div');
        welcomeContainer.className = 'container';
        var welcomeDiv = document.createElement('div');
        welcomeDiv.style.cssText = 'text-align: center; padding: 20px; background: linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%); border-radius: 15px; margin: 0 auto; max-width: 600px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 2px solid #ff6f61;';
        var userName = user.name || user.email || 'Customer';
        welcomeDiv.innerHTML = '<h2 style="color: #ff6f61; margin-bottom: 10px; font-size: 28px;">👋 Welcome back, ' + userName + '!</h2>' +
          '<p style="color: #555; font-size: 16px; margin: 0; line-height: 1.6;">Discover amazing restaurants and delicious meals with great discounts. Browse below and place your order!</p>';
        welcomeContainer.appendChild(welcomeDiv);
        welcomeSection.appendChild(welcomeContainer);
        // Insert welcome message between hero and search section
        searchSection.parentNode.insertBefore(welcomeSection, searchSection);
      }
    }

    // Create orders section after restaurants section
    var ordersSection = document.createElement('section');
    ordersSection.id = 'customer-orders';
    ordersSection.style.cssText = 'padding: 60px 20px; background-color: #fff; text-align: center;';
    
    var ordersContainer = document.createElement('div');
    ordersContainer.className = 'container';
    ordersSection.appendChild(ordersContainer);

    var orders = getUserOrders();
    var listWrap = document.createElement('div');
    listWrap.className = 'service-boxes';
    listWrap.style.cssText = 'justify-content: center; gap: 20px; flex-wrap: wrap;';
    ordersContainer.appendChild(listWrap);

    function formatDate(timestamp) {
      if (!timestamp) return 'N/A';
      var date = new Date(timestamp);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    function getStatusColor(status) {
      var colors = {
        'pending': '#ff9800',
        'confirmed': '#2196f3',
        'delivered': '#4caf50',
        'cancelled': '#f44336'
      };
      return colors[status] || '#666';
    }

    function renderOrders() {
      listWrap.innerHTML = '';
      if (orders.length === 0) {
        listWrap.innerHTML = '<div style="text-align:center;padding:40px;color:#999;width:100%;"><p style="font-size:18px;margin-bottom:10px;">No orders yet.</p><p>Browse restaurants above and place your first order!</p></div>';
        return;
      }

      orders.forEach(function(order) {
        var total = 0;
        var itemsHtml = '';
        var totalSavings = order.total_savings || 0;
        if (order.items && order.items.length > 0) {
          order.items.forEach(function(item) {
            var itemTotal = (item.price || 0) * (item.quantity || 1);
            total += itemTotal;
            var itemSavings = item.savings || ((item.old_price && item.old_price > item.price) ? (item.old_price - item.price) * (item.quantity || 1) : 0);
            var itemOriginalTotal = item.old_price ? item.old_price * (item.quantity || 1) : itemTotal;
            var savingsHtml = itemSavings > 0 ? '<div style="font-size:11px;color:#4caf50;margin-top:2px;">💚 Saved: ¥' + itemSavings.toFixed(0) + '</div>' : '';
            var priceDisplay = itemSavings > 0 ? '<div style="text-align:right;"><span style="text-decoration:line-through;color:#999;font-size:11px;">¥' + itemOriginalTotal.toFixed(0) + '</span><br><span style="color:#ff6f61;font-weight:600;">¥' + itemTotal.toFixed(0) + '</span></div>' : '<span>¥' + itemTotal.toFixed(0) + '</span>';
            itemsHtml += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px;">' +
              '<div><span>' + (item.name || 'Item') + ' x' + (item.quantity || 1) + '</span>' + savingsHtml + '</div>' +
              '<div>' + priceDisplay + '</div>' +
              '</div>';
          });
        }

        var box = document.createElement('div');
        box.className = 'box';
        box.style.maxWidth = '400px';
        box.style.textAlign = 'left';
        box.style.padding = '20px';
        var estimatedTimeHtml = order.estimated_delivery_time ? '<div style="margin:10px 0;padding:8px;background:#e3f2fd;border-radius:6px;"><small style="color:#1976d2;">⏱️ Estimated delivery: ' + order.estimated_delivery_time + ' minutes</small></div>' : '';
        var addressHtml = order.address ? '<div style="margin:10px 0;padding:8px;background:#f5f5f5;border-radius:6px;"><small style="color:#666;">📍 ' + order.address + '</small></div>' : '';
        var savingsHtml = totalSavings > 0 ? '<div style="margin:10px 0;padding:8px;background:#e8f5e9;border-radius:6px;border:1px solid #4caf50;"><small style="color:#2e7d32;font-weight:600;">💰 Total Savings: ¥' + totalSavings.toFixed(0) + '</small></div>' : '';
        box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding-bottom:15px;border-bottom:2px solid #eee;">' +
          '<div><h3 style="margin:0;color:#ff6f61;">Order #' + order.id + '</h3><small style="color:#666;">' + formatDate(order.created_at) + '</small></div>' +
          '<span style="padding:6px 12px;border-radius:6px;background:' + getStatusColor(order.status) + ';color:white;font-size:12px;font-weight:600;">' + (order.status || 'pending').toUpperCase() + '</span>' +
          '</div>' +
          addressHtml +
          estimatedTimeHtml +
          '<div style="margin:15px 0;">' + itemsHtml + '</div>' +
          savingsHtml +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:15px;border-top:2px solid #eee;margin-top:15px;">' +
          '<strong style="font-size:18px;color:#ff6f61;">Total: ¥' + total.toFixed(2) + '</strong>' +
          (order.status === 'pending' ? '<button class="edit-order-btn" data-order-id="' + order.id + '" style="padding:8px 16px;border-radius:6px;border:none;background:#ff6f61;color:white;cursor:pointer;font-size:14px;margin-left:10px;">Edit</button>' +
          '<button class="cancel-order-btn" data-order-id="' + order.id + '" style="padding:8px 16px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:14px;margin-left:5px;">Cancel</button>' +
          '<button class="track-order-btn" data-order-id="' + order.id + '" style="padding:8px 16px;border-radius:6px;border:none;background:#2196f3;color:white;cursor:pointer;font-size:14px;margin-left:5px;">Track</button>' : '') +
          '</div>';
        listWrap.appendChild(box);
      });

      // Attach event listeners
      listWrap.querySelectorAll('.cancel-order-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var orderId = parseInt(btn.getAttribute('data-order-id'));
          if (confirm('Are you sure you want to cancel this order?')) {
            var allOrders = getStorage(STORAGE_ORDERS, []);
            var orderIndex = allOrders.findIndex(function(o) { return o.id === orderId && o.user_id === user.id; });
            if (orderIndex >= 0) {
              allOrders[orderIndex].status = 'cancelled';
              setStorage(STORAGE_ORDERS, allOrders);
              orders = getUserOrders();
              renderOrders();
            }
          }
        });
      });

      listWrap.querySelectorAll('.edit-order-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var orderId = parseInt(btn.getAttribute('data-order-id'));
          showEditOrder(orderId);
        });
      });

      listWrap.querySelectorAll('.track-order-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var orderId = parseInt(btn.getAttribute('data-order-id'));
          var order = orders.find(function(o) { return o.id === orderId; });
          if (order) {
            showOrderTracking(order);
          }
        });
      });
    }

    // Add heading for orders section
    var ordersHeading = document.createElement('h2');
    ordersHeading.style.cssText = 'color: #ff6f61; margin-bottom: 40px;';
    ordersHeading.textContent = 'My Orders';
    ordersContainer.insertBefore(ordersHeading, listWrap);

    // Hide or modify the hero section for customers - remove any text about "grow your business by helping others"
    var heroSection = document.querySelector('section.hero');
    if (heroSection) {
      var paragraphs = heroSection.querySelectorAll('p');
      paragraphs.forEach(function(p) {
        var text = p.textContent.toLowerCase();
        if (text.includes('grow your business') || text.includes('helping others') || text.includes('grow') && text.includes('business') && text.includes('helping')) {
          p.remove();
        }
      });
    }

    renderOrders();
    
    // Insert orders section after restaurants section
    restaurantsSection.parentNode.insertBefore(ordersSection, restaurantsSection.nextSibling);
  }

  // Show edit order modal
  function showEditOrder(orderId) {
    var user = getCurrentUser();
    if (!user) return;

    var allOrders = getStorage(STORAGE_ORDERS, []);
    var order = allOrders.find(function(o) { return o.id === orderId && o.user_id === user.id; });
    if (!order || (order.status !== 'pending' && order.status !== 'confirmed')) {
      alert('This order cannot be edited. Only pending or confirmed orders can be edited.');
      return;
    }

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:white;padding:30px;border-radius:12px;max-width:600px;width:90%;max-height:90vh;overflow-y:auto;';

    var itemsHtml = '';
    var total = 0;
    if (order.items && order.items.length > 0) {
      order.items.forEach(function(item, index) {
        var itemTotal = (item.price || 0) * (item.quantity || 1);
        total += itemTotal;
        itemsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid #eee;border-radius:6px;margin-bottom:10px;">' +
          '<div style="flex:1;"><strong>' + (item.name || 'Item') + '</strong><br><small>¥' + (item.price || 0).toFixed(2) + ' each</small></div>' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
          '<button class="qty-dec" data-index="' + index + '" style="width:30px;height:30px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;">-</button>' +
          '<span class="qty-display" data-index="' + index + '" style="min-width:30px;text-align:center;font-weight:600;">' + (item.quantity || 1) + '</span>' +
          '<button class="qty-inc" data-index="' + index + '" style="width:30px;height:30px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;">+</button>' +
          '<button class="remove-item" data-index="' + index + '" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;margin-left:10px;font-size:12px;">Remove</button>' +
          '</div>' +
          '</div>';
      });
    }

    box.innerHTML = '<h2 style="color:#ff6f61;margin-bottom:20px;">Edit Order #' + order.id + '</h2>' +
      '<div id="edit-order-items">' + itemsHtml + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:15px;border-top:2px solid #eee;margin-top:15px;">' +
      '<strong style="font-size:18px;">Total: ¥<span id="edit-order-total">' + total.toFixed(2) + '</span></strong>' +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">' +
      '<button id="edit-order-cancel" style="padding:10px 20px;border-radius:6px;border:1px solid #ccc;background:white;cursor:pointer;">Cancel</button>' +
      '<button id="edit-order-save" style="padding:10px 20px;border-radius:6px;border:none;background:#ff6f61;color:white;cursor:pointer;">Save Changes</button>' +
      '</div>';

    modal.appendChild(box);
    document.body.appendChild(modal);

    var currentItems = JSON.parse(JSON.stringify(order.items || []));

    function updateTotal() {
      var newTotal = currentItems.reduce(function(sum, item) {
        return sum + (item.price || 0) * (item.quantity || 1);
      }, 0);
      box.querySelector('#edit-order-total').textContent = newTotal.toFixed(2);
    }

    // Use event delegation for quantity buttons
    if (!box._qtyButtonsHandlerAttached) {
      box.addEventListener('click', function(e) {
        var btn = e.target;
        var btnClass = null;
        
        // Find which button was clicked
        while (btn && btn !== box) {
          if (btn.classList.contains('qty-inc')) {
            btnClass = 'inc';
            break;
          } else if (btn.classList.contains('qty-dec')) {
            btnClass = 'dec';
            break;
          }
          btn = btn.parentElement;
        }
        
        if (!btn || btn === box || !btnClass) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        var index = parseInt(btn.getAttribute('data-index'));
        if (isNaN(index) || index < 0 || index >= currentItems.length || !currentItems[index]) return;
        
        if (btnClass === 'inc') {
          // Increase quantity
          currentItems[index].quantity = (currentItems[index].quantity || 1) + 1;
          box.querySelector('.qty-display[data-index="' + index + '"]').textContent = currentItems[index].quantity;
          updateTotal();
        } else if (btnClass === 'dec') {
          // Decrease quantity
          if (currentItems[index].quantity > 1) {
            // Decrease quantity
            currentItems[index].quantity = currentItems[index].quantity - 1;
            box.querySelector('.qty-display[data-index="' + index + '"]').textContent = currentItems[index].quantity;
            updateTotal();
          } else if (currentItems[index].quantity === 1) {
            // If quantity is 1, ask to remove the item
            if (confirm('Remove ' + (currentItems[index].name || 'this item') + ' from the order?')) {
              currentItems.splice(index, 1);
              if (currentItems.length === 0) {
                alert('Order must have at least one item. Cancel the order instead.');
                return;
              }
              // Re-render items
              var itemsHtml = '';
              currentItems.forEach(function(item, idx) {
                var itemTotal = (item.price || 0) * (item.quantity || 1);
                itemsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid #eee;border-radius:6px;margin-bottom:10px;">' +
                  '<div style="flex:1;"><strong>' + (item.name || 'Item') + '</strong><br><small>¥' + (item.price || 0).toFixed(2) + ' each</small></div>' +
                  '<div style="display:flex;align-items:center;gap:10px;">' +
                  '<button class="qty-dec" data-index="' + idx + '" style="width:30px;height:30px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;">-</button>' +
                  '<span class="qty-display" data-index="' + idx + '" style="min-width:30px;text-align:center;font-weight:600;">' + (item.quantity || 1) + '</span>' +
                  '<button class="qty-inc" data-index="' + idx + '" style="width:30px;height:30px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;">+</button>' +
                  '<button class="remove-item" data-index="' + idx + '" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;margin-left:10px;font-size:12px;">Remove</button>' +
                  '</div>' +
                  '</div>';
              });
              box.querySelector('#edit-order-items').innerHTML = itemsHtml;
              updateTotal();
              // Re-attach event listeners (for remove button)
              attachEditOrderListeners();
            }
          }
        }
      });
      box._qtyButtonsHandlerAttached = true;
    }
    
    function attachEditOrderListeners() {
      // This function now only handles remove button listeners
      // Quantity buttons are handled via event delegation above

      // Use event delegation for remove item buttons
      if (!box._removeItemHandlerAttached) {
        box.addEventListener('click', function(e) {
          var removeBtn = e.target;
          while (removeBtn && removeBtn !== box && !removeBtn.classList.contains('remove-item')) {
            removeBtn = removeBtn.parentElement;
          }
          
          if (!removeBtn || removeBtn === box || !removeBtn.classList.contains('remove-item')) return;
          
          e.preventDefault();
          e.stopPropagation();
          
          var index = parseInt(removeBtn.getAttribute('data-index'));
          if (isNaN(index) || index < 0 || index >= currentItems.length) return;
          
          if (confirm('Remove this item from the order?')) {
            currentItems.splice(index, 1);
            if (currentItems.length === 0) {
              alert('Order must have at least one item. Cancel the order instead.');
              return;
            }
            // Re-render items
            var itemsHtml = '';
            currentItems.forEach(function(item, idx) {
              var itemTotal = (item.price || 0) * (item.quantity || 1);
              itemsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid #eee;border-radius:6px;margin-bottom:10px;">' +
                '<div style="flex:1;"><strong>' + (item.name || 'Item') + '</strong><br><small>¥' + (item.price || 0).toFixed(2) + ' each</small></div>' +
                '<div style="display:flex;align-items:center;gap:10px;">' +
                '<button class="qty-dec" data-index="' + idx + '" style="width:30px;height:30px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;">-</button>' +
                '<span class="qty-display" data-index="' + idx + '" style="min-width:30px;text-align:center;font-weight:600;">' + (item.quantity || 1) + '</span>' +
                '<button class="qty-inc" data-index="' + idx + '" style="width:30px;height:30px;border-radius:50%;border:1px solid #ccc;background:white;cursor:pointer;">+</button>' +
                '<button class="remove-item" data-index="' + idx + '" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;margin-left:10px;font-size:12px;">Remove</button>' +
                '</div>' +
                '</div>';
            });
            box.querySelector('#edit-order-items').innerHTML = itemsHtml;
            updateTotal();
            // Re-attach event listeners
            attachEditOrderListeners();
          }
        });
        box._removeItemHandlerAttached = true;
      }
    }

    attachEditOrderListeners();

    box.querySelector('#edit-order-cancel').addEventListener('click', function() {
      document.body.removeChild(modal);
    });

    box.querySelector('#edit-order-save').addEventListener('click', function() {
      if (currentItems.length === 0) {
        alert('Order must have at least one item.');
        return;
      }
      var allOrders = getStorage(STORAGE_ORDERS, []);
      var orderIndex = allOrders.findIndex(function(o) { return o.id === orderId && o.user_id === user.id; });
      if (orderIndex >= 0) {
        // Recalculate savings for updated items
        var updatedSavings = currentItems.reduce(function(sum, item) {
          var itemSavings = item.savings || ((item.old_price && item.old_price > item.price) ? (item.old_price - item.price) * (item.quantity || 1) : 0);
          return sum + itemSavings;
        }, 0);
        
        allOrders[orderIndex].items = currentItems;
        allOrders[orderIndex].total_savings = updatedSavings;
        setStorage(STORAGE_ORDERS, allOrders);
        document.body.removeChild(modal);
        // Refresh the orders view
        if (/res\.html$/i.test(location.pathname)) {
          initCustomerOrdersView();
        }
        // If on orders page, reload it
        if (/orders\.html$/i.test(location.pathname)) {
          alert('Order updated successfully!');
          location.reload();
          return;
        }
        // Refresh orders and savings modal if it exists
        var ordersSavingsModal = document.querySelector('[style*="z-index:1003"]');
        if (ordersSavingsModal) {
          setTimeout(function() {
            document.body.removeChild(ordersSavingsModal);
            showOrdersAndSavings();
          }, 100);
        }
        // Refresh UI
        initAuthUi();
        alert('Order updated successfully!');
      }
    });
  }

  // Initialize restaurant filters
  function initRestaurantFilters() {
    var container = document.querySelector('#restaurants .container');
    var searchInput = document.querySelector('input[placeholder="Search restaurants..."]');
    var selects = Array.prototype.slice.call(document.querySelectorAll('section select'));
    if (!container || !searchInput || !selects.length) {
      // If no filters, initialize with default restaurants if none exist
      var restaurants = getRestaurants();
      if (restaurants.length === 0) {
        // Seed default restaurants
        var defaults = [
          { id: 'lawson', name: 'Lawson', area: 'Kamegawa', cuisine: 'Japanese', price_level: '¥', halal: false, image_url: 'lawson.jpg' },
          { id: 'gyomu', name: 'Gyomu', area: 'Mochigahama', cuisine: 'Japanese', price_level: '¥', halal: true, image_url: 'gyomu.jpg' },
          { id: 'marushoku', name: 'Marushoku', area: 'Minamisuga', cuisine: 'Chinese', price_level: '¥', halal: true, image_url: 'maru.jpg' }
        ];
        defaults.forEach(function(r) {
          if (!restaurants.find(function(existing) { return existing.id === r.id; })) {
            restaurants.push(r);
          }
        });
        setStorage(STORAGE_RESTAURANTS, restaurants);
      }
      return;
    }

    var listWrap = container.querySelector('.service-boxes');
    function render(restaurants) {
      if (!listWrap) return;
      listWrap.innerHTML = '';
      restaurants.forEach(function(r) {
        // Determine the link URL
        var linkUrl = null;
        if (r.link) {
          linkUrl = r.link;
        } else if (String(r.id) === 'lawson') {
          linkUrl = './lawson.html';
        } else if (String(r.id) === 'gyomu') {
          linkUrl = './Gyomu.html';
        } else if (String(r.id) === 'marushoku') {
          linkUrl = './marushoku.html';
        } else if (r.id) {
          linkUrl = './restaurant.html?rid=' + encodeURIComponent(String(r.id));
        }
        
        var box = document.createElement('div');
        box.className = 'box';
        box.style.maxWidth = '300px';
        if (linkUrl) {
          box.style.cursor = 'pointer';
          box.style.textDecoration = 'none';
          box.style.color = 'inherit';
          box.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = linkUrl;
            return false;
          };
        }
        
        var imgWrap = document.createElement('div');
        imgWrap.style.cssText = 'background-color:#ffffff;height:150px;border-radius:15px;margin-bottom:15px;overflow:hidden;display:flex;justify-content:center;align-items:center;';
        if (r.image_url) {
          var img = document.createElement('img');
          img.src = r.image_url;
          img.alt = r.name;
          img.style.maxWidth = '100%';
          img.style.maxHeight = '100%';
          img.style.objectFit = 'contain';
          
          if (linkUrl) {
            var a = document.createElement('a');
            a.href = linkUrl;
            a.style.textDecoration = 'none';
            a.style.display = 'block';
            a.style.width = '100%';
            a.style.height = '100%';
            a.onclick = function(e) {
              e.stopPropagation();
            };
            a.appendChild(img);
            imgWrap.appendChild(a);
          } else {
            imgWrap.appendChild(img);
          }
        }
        var h3 = document.createElement('h3');
        h3.textContent = r.name;
        var p = document.createElement('p');
        // Convert $ to ¥ for display
        var priceLevel = (r.price_level || '¥');
        if (priceLevel === '$') priceLevel = '¥';
        else if (priceLevel === '$$') priceLevel = '¥¥';
        else if (priceLevel === '$$$') priceLevel = '¥¥¥';
        p.textContent = 'Area: ' + (r.area || '-') + ' | Type: ' + (r.cuisine || '-') + ' | ' + priceLevel;
        box.appendChild(imgWrap);
        box.appendChild(h3);
        box.appendChild(p);
        listWrap.appendChild(box);
      });
    }

    function load() {
      var area = selects[0] && selects[0].value;
      var cuisine = selects[1] && selects[1].value;
      var price = selects[2] && selects[2].value;
      var q = searchInput.value.toLowerCase();
      
      // Build API query parameters
      var params = new URLSearchParams();
      if (q) params.append('q', q);
      if (area && area !== 'All Areas') params.append('area', area);
      if (cuisine && cuisine !== 'All Cuisines') params.append('cuisine', cuisine);
      if (price && price !== 'All Prices') params.append('price', price);
      
      // Fetch from API
      fetch('/api/restaurants?' + params.toString())
        .then(function(res) { return res.json(); })
        .then(function(data) {
          var apiRestaurants = data.restaurants || [];
          // Merge with localStorage restaurants (for backward compatibility)
          var localRestaurants = getRestaurants();
          var all = apiRestaurants.slice();
          
          // Add local restaurants that aren't in API (for backward compatibility)
          localRestaurants.forEach(function(lr) {
            if (!all.find(function(r) { return String(r.id) === String(lr.id); })) {
              all.push(lr);
            }
          });
          
          // Apply client-side filtering if needed (for local restaurants)
          var filtered = all.filter(function(r) {
            if (q && !r.name.toLowerCase().includes(q)) return false;
            if (area && area !== 'All Areas' && r.area !== area) return false;
            if (cuisine && cuisine !== 'All Cuisines') {
              // Special handling for Halal - check halal attribute instead of cuisine
              if (cuisine === 'Halal') {
                if (!r.halal) return false;
              } else {
                // For other cuisines, check the cuisine attribute
                if (r.cuisine !== cuisine) return false;
              }
            }
            if (price && price !== 'All Prices' && r.price_level !== price) return false;
            return true;
          });
          render(filtered);
        })
        .catch(function(err) {
          console.error('Error fetching restaurants:', err);
          // Fallback to localStorage
          var all = getRestaurants();
          var filtered = all.filter(function(r) {
            if (q && !r.name.toLowerCase().includes(q)) return false;
            if (area && area !== 'All Areas' && r.area !== area) return false;
            if (cuisine && cuisine !== 'All Cuisines') {
              // Special handling for Halal - check halal attribute instead of cuisine
              if (cuisine === 'Halal') {
                if (!r.halal) return false;
              } else {
                // For other cuisines, check the cuisine attribute
                if (r.cuisine !== cuisine) return false;
              }
            }
            if (price && price !== 'All Prices' && r.price_level !== price) return false;
            return true;
          });
          render(filtered);
        });
    }

    searchInput.addEventListener('input', load);
    selects.forEach(function(s) { s.addEventListener('change', load); });
    load();
  }

  // Initialize orders page if on orders.html
  function initOrdersPage() {
    if (!/orders\.html$/i.test(location.pathname)) return;
    
    var user = getCurrentUser();
    if (!user || user.role === 'owner') {
      var content = document.getElementById('orders-savings-content');
      if (content) {
        content.innerHTML = 
          '<div class="container"><div style="text-align:center;padding:40px;color:#666;"><p style="font-size:18px;margin-bottom:10px;">Access Denied</p><p>This page is only available for customers. Please <a href="./login.html" style="color:#ff6f61;">login</a> as a customer to view your orders.</p></div></div>';
      }
      return;
    }

    var orders = getUserOrders();
    var pendingOrders = orders.filter(function(o) { return o.status === 'pending' || o.status === 'confirmed'; });
    
    // Calculate lifetime savings from all orders
    // If total_savings is not set, calculate from items
    var totalSavings = orders.reduce(function(sum, order) {
      if (order.total_savings !== undefined && order.total_savings !== null) {
        return sum + order.total_savings;
      }
      // Calculate savings from items if total_savings is not set
      if (order.items && order.items.length > 0) {
        var orderSavings = order.items.reduce(function(itemSum, item) {
          var itemSavings = item.savings || ((item.old_price && item.old_price > item.price) ? (item.old_price - item.price) * (item.quantity || 1) : 0);
          return itemSum + itemSavings;
        }, 0);
        // Update order with calculated savings if missing
        if (orderSavings > 0) {
          var allOrders = getStorage(STORAGE_ORDERS, []);
          var orderIndex = allOrders.findIndex(function(o) { return o.id === order.id; });
          if (orderIndex >= 0) {
            allOrders[orderIndex].total_savings = orderSavings;
            setStorage(STORAGE_ORDERS, allOrders);
          }
        }
        return sum + orderSavings;
      }
      return sum;
    }, 0);
    var lifetimeSavings = totalSavings;

    function formatDate(timestamp) {
      if (!timestamp) return 'N/A';
      var date = new Date(timestamp);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    function getStatusColor(status) {
      var colors = {
        'pending': '#ff9800',
        'confirmed': '#2196f3',
        'delivered': '#4caf50',
        'cancelled': '#f44336'
      };
      return colors[status] || '#666';
    }

    // Calculate current orders total and savings
    var currentOrdersTotal = 0;
    var currentOrdersSavings = 0;
    pendingOrders.forEach(function(order) {
      if (order.items && order.items.length > 0) {
        order.items.forEach(function(item) {
          currentOrdersTotal += (item.price || 0) * (item.quantity || 1);
        });
      }
      // Use total_savings if available, otherwise calculate from items
      if (order.total_savings !== undefined && order.total_savings !== null) {
        currentOrdersSavings += order.total_savings;
      } else if (order.items && order.items.length > 0) {
        var orderSavings = order.items.reduce(function(itemSum, item) {
          var itemSavings = item.savings || ((item.old_price && item.old_price > item.price) ? (item.old_price - item.price) * (item.quantity || 1) : 0);
          return itemSum + itemSavings;
        }, 0);
        currentOrdersSavings += orderSavings;
        // Update order with calculated savings if missing
        if (orderSavings > 0) {
          var allOrders = getStorage(STORAGE_ORDERS, []);
          var orderIndex = allOrders.findIndex(function(o) { return o.id === order.id; });
          if (orderIndex >= 0) {
            allOrders[orderIndex].total_savings = orderSavings;
            setStorage(STORAGE_ORDERS, allOrders);
          }
        }
      }
    });

    var currentOrdersHtml = '';
    if (pendingOrders.length === 0) {
      currentOrdersHtml = '<div style="text-align:center;padding:40px;color:#999;background:white;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);"><p style="font-size:18px;margin-bottom:10px;">No current orders</p><p>Browse restaurants and place your first order!</p></div>';
    } else {
      pendingOrders.forEach(function(order) {
        var total = 0;
        var itemsHtml = '';
        if (order.items && order.items.length > 0) {
          order.items.forEach(function(item) {
            var itemTotal = (item.price || 0) * (item.quantity || 1);
            total += itemTotal;
            var itemSavings = item.savings || ((item.old_price && item.old_price > item.price) ? (item.old_price - item.price) * (item.quantity || 1) : 0);
            var itemOriginalTotal = item.old_price ? item.old_price * (item.quantity || 1) : itemTotal;
            var savingsHtml = itemSavings > 0 ? '<div style="font-size:11px;color:#4caf50;margin-top:2px;">💚 Saved: ¥' + itemSavings.toFixed(0) + '</div>' : '';
            var priceDisplay = itemSavings > 0 ? '<div style="text-align:right;"><span style="text-decoration:line-through;color:#999;font-size:11px;">¥' + itemOriginalTotal.toFixed(0) + '</span><br><span style="color:#ff6f61;font-weight:600;">¥' + itemTotal.toFixed(0) + '</span></div>' : '<span>¥' + itemTotal.toFixed(0) + '</span>';
            itemsHtml += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px;">' +
              '<div><span>' + (item.name || 'Item') + ' x' + (item.quantity || 1) + '</span>' + savingsHtml + '</div>' +
              '<div>' + priceDisplay + '</div>' +
              '</div>';
          });
        }
        var orderSavings = order.total_savings || 0;
        var estimatedTimeHtml = order.estimated_delivery_time ? '<div style="margin:8px 0;padding:6px;background:#e3f2fd;border-radius:4px;"><small style="color:#1976d2;">⏱️ Estimated: ' + order.estimated_delivery_time + ' minutes</small></div>' : '';
        var addressHtml = order.address ? '<div style="margin:8px 0;padding:6px;background:#f5f5f5;border-radius:4px;"><small style="color:#666;">📍 ' + order.address + '</small></div>' : '';
        var savingsHtml = orderSavings > 0 ? '<div style="margin:8px 0;padding:8px;background:#e8f5e9;border-radius:4px;border:1px solid #4caf50;"><small style="color:#2e7d32;font-weight:600;">💰 Savings: ¥' + orderSavings.toFixed(0) + '</small></div>' : '';
        currentOrdersHtml += '<div style="border:2px solid #eee;border-radius:8px;padding:15px;margin-bottom:15px;background:#fafafa;box-shadow:0 2px 8px rgba(0,0,0,0.1);">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:2px solid #eee;">' +
          '<div><strong style="color:#ff6f61;font-size:16px;">Order #' + order.id + '</strong><br><small style="color:#666;">' + formatDate(order.created_at) + '</small></div>' +
          '<span style="padding:6px 12px;border-radius:6px;background:' + getStatusColor(order.status) + ';color:white;font-size:12px;font-weight:600;">' + (order.status || 'pending').toUpperCase() + '</span>' +
          '</div>' +
          addressHtml +
          estimatedTimeHtml +
          '<div style="margin:10px 0;">' + itemsHtml + '</div>' +
          savingsHtml +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:2px solid #eee;margin-top:10px;">' +
          '<strong style="font-size:16px;color:#ff6f61;">Total: ¥' + total.toFixed(2) + '</strong>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="edit-order-btn" data-order-id="' + order.id + '" style="padding:6px 12px;border-radius:6px;border:none;background:#ff6f61;color:white;cursor:pointer;font-size:12px;">Edit</button>' +
          '<button class="track-order-btn" data-order-id="' + order.id + '" style="padding:6px 12px;border-radius:6px;border:none;background:#2196f3;color:white;cursor:pointer;font-size:12px;">Track</button>' +
          '<button class="delete-order-btn" data-order-id="' + order.id + '" style="padding:6px 12px;border-radius:6px;border:none;background:#f44336;color:white;cursor:pointer;font-size:12px;">Delete</button>' +
          '</div>' +
          '</div>' +
          '</div>';
      });
    }

    var contentHtml = 
      // Savings Summary
      '<div style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);padding:25px;border-radius:12px;margin-bottom:30px;color:white;box-shadow:0 4px 15px rgba(102,126,234,0.3);">' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:20px;text-align:center;">' +
      '<div style="background:rgba(255,255,255,0.2);padding:20px;border-radius:8px;backdrop-filter:blur(10px);">' +
      '<div style="font-size:32px;margin-bottom:8px;">💰</div>' +
      '<div style="font-size:24px;font-weight:700;margin-bottom:5px;">¥' + lifetimeSavings.toFixed(0) + '</div>' +
      '<div style="font-size:13px;opacity:0.9;">Lifetime Savings</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.2);padding:20px;border-radius:8px;backdrop-filter:blur(10px);">' +
      '<div style="font-size:32px;margin-bottom:8px;">🛒</div>' +
      '<div style="font-size:24px;font-weight:700;margin-bottom:5px;">' + pendingOrders.length + '</div>' +
      '<div style="font-size:13px;opacity:0.9;">Current Orders</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.2);padding:20px;border-radius:8px;backdrop-filter:blur(10px);">' +
      '<div style="font-size:32px;margin-bottom:8px;">💚</div>' +
      '<div style="font-size:24px;font-weight:700;margin-bottom:5px;">¥' + currentOrdersSavings.toFixed(0) + '</div>' +
      '<div style="font-size:13px;opacity:0.9;">Savings on Current Orders</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      
      // Current Orders Section
      '<div style="margin-bottom:20px;">' +
      '<h3 style="color:#333;margin-bottom:15px;font-size:20px;border-bottom:2px solid #eee;padding-bottom:10px;">📦 Current Orders</h3>' +
      '<div id="current-orders-list">' + currentOrdersHtml + '</div>' +
      '</div>' +
      
      // View Full History Button
      '<div style="text-align:center;margin-top:30px;">' +
      '<button id="view-full-history" style="padding:12px 24px;border:2px solid #ff6f61;border-radius:8px;background:transparent;color:#ff6f61;cursor:pointer;font-weight:600;font-size:16px;">View Full Order History</button>' +
      '</div>';

    var content = document.getElementById('orders-savings-content');
    if (content) {
      content.innerHTML = contentHtml;

      // Event listeners
      var historyBtn = document.getElementById('view-full-history');
      if (historyBtn) {
        historyBtn.addEventListener('click', function() {
          showOrderHistory();
        });
      }

      // Use event delegation for all order buttons on orders page
      var ordersContainer = document.querySelector('#orders-savings-content') || document.body;
      if (!ordersContainer._orderButtonsHandlerAttached) {
        ordersContainer.addEventListener('click', function(e) {
          var btn = e.target;
          var btnClass = null;
          
          // Find which button was clicked
          while (btn && btn !== ordersContainer) {
            if (btn.classList.contains('edit-order-btn')) {
              btnClass = 'edit';
              break;
            } else if (btn.classList.contains('track-order-btn')) {
              btnClass = 'track';
              break;
            } else if (btn.classList.contains('delete-order-btn')) {
              btnClass = 'delete';
              break;
            } else if (btn.classList.contains('cancel-order-btn')) {
              btnClass = 'cancel';
              break;
            }
            btn = btn.parentElement;
          }
          
          if (!btn || btn === ordersContainer || !btnClass) return;
          
          e.preventDefault();
          e.stopPropagation();
          
          var orderId = parseInt(btn.getAttribute('data-order-id'));
          if (isNaN(orderId)) return;
          
          if (btnClass === 'edit') {
            showEditOrder(orderId);
          } else if (btnClass === 'track') {
            var order = pendingOrders.find(function(o) { return o.id === orderId; });
            if (order) {
              showOrderTracking(order);
            }
          } else if (btnClass === 'delete') {
            if (confirm('Are you sure you want to delete this order? This action cannot be undone.')) {
              var allOrders = getStorage(STORAGE_ORDERS, []);
              var orderIndex = allOrders.findIndex(function(o) { return o.id === orderId && o.user_id === user.id; });
              if (orderIndex >= 0) {
                allOrders.splice(orderIndex, 1);
                setStorage(STORAGE_ORDERS, allOrders);
                // Reload the page to refresh
                location.reload();
              }
            }
          } else if (btnClass === 'cancel') {
            if (confirm('Are you sure you want to cancel this order?')) {
              var allOrders = getStorage(STORAGE_ORDERS, []);
              var orderIndex = allOrders.findIndex(function(o) { return o.id === orderId && o.user_id === user.id; });
              if (orderIndex >= 0) {
                allOrders[orderIndex].status = 'cancelled';
                setStorage(STORAGE_ORDERS, allOrders);
                // Reload the page to refresh
                location.reload();
              }
            }
          }
        });
        ordersContainer._orderButtonsHandlerAttached = true;
      }
    }
  }

  // Initialize everything
  document.addEventListener('DOMContentLoaded', function() {
    // One-time cleanup: delete restaurants named "chillox" (case-insensitive)
    try {
      var cleanupFlag = localStorage.getItem('mm_cleanup_chillox_done');
      if (cleanupFlag !== 'yes') {
        var rests = getStorage(STORAGE_RESTAURANTS, []);
        var toRemove = (rests || []).filter(function(r){ return (r.name||'').toLowerCase() === 'chillox'; }).map(function(r){ return r.id; });
        if (toRemove.length) {
          var kept = rests.filter(function(r){ return toRemove.indexOf(r.id) === -1; });
          setStorage(STORAGE_RESTAURANTS, kept);
          var allItems = getStorage(STORAGE_MENU_ITEMS, []);
          var keptItems = allItems.filter(function(it){ return toRemove.indexOf(it.restaurant_id) === -1; });
          setStorage(STORAGE_MENU_ITEMS, keptItems);
        }
        localStorage.setItem('mm_cleanup_chillox_done', 'yes');
      }
    } catch(e) {}

    initAuthUi();
    initLoginSignup();
    initOrdering();
    // Initialize orders page if on orders.html
    initOrdersPage();
    // Show restaurants for everyone, but add orders section for customers
    var user = getCurrentUser();
    if (user && user.role === 'customer' && /res\.html$/i.test(location.pathname)) {
      // Add orders section for customers, but keep restaurants visible
      initCustomerOrdersSection();
      initRestaurantFilters();
    } else {
      initRestaurantFilters();
    }
    initOwnerDashboardPage();
  });
})();
