// Ticker content - duplicated for seamless loop
const words = ["REPEAT CULT", "BATCH DROPS ONLY", "CULTURE OVER CLOTHING", "250 GSM COTTON", "AMRITSAR, PUNJAB", "NOT JUST CLOTHING"];
const tickerInner = document.getElementById('tickerInner');
if (tickerInner) {
  const html = words.map(w => `<span>${w}</span>`).join('');
  tickerInner.innerHTML = html + html;
}

// -------------------------------------------------------------
// CART & E-COMMERCE STATE
// -------------------------------------------------------------
let cart = [];

function showToast(message) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function updateCartBadge() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartBtn = document.getElementById('cartBtn');
  if (cartBtn) {
    cartBtn.textContent = count;
  }
  const drawerBadge = document.getElementById('drawerCartCountBadge');
  if (drawerBadge) {
    drawerBadge.textContent = `${count} ${count === 1 ? 'PIECE' : 'PIECES'}`;
  }
}

function openCart() {
  renderCart();
  const overlay = document.getElementById('cartOverlay');
  if (overlay) overlay.classList.add('open');
}

function closeCart() {
  const overlay = document.getElementById('cartOverlay');
  if (overlay) overlay.classList.remove('open');
}

function handleOverlayClick(e) {
  if (e.target.id === 'cartOverlay') {
    closeCart();
  }
}

function addToCart(name, price = 1199, size = 'M') {
  const existingIndex = cart.findIndex(item => item.name === name && item.size === size);
  if (existingIndex > -1) {
    cart[existingIndex].quantity += 1;
  } else {
    cart.push({
      id: `${name}-${size}-${Date.now()}`,
      name,
      price: Number(price) || 1199,
      size,
      quantity: 1
    });
  }

  updateCartBadge();
  showToast(`${name} (${size}) added to bag`);
  openCart();
}

function addFeaturedToCart() {
  const activeSizeEl = document.querySelector('.featured .size-box.active');
  const size = activeSizeEl ? activeSizeEl.textContent.trim() : 'M';
  addToCart('Grey Culture 2.0 (Batch 002)', 999, size);
}

function changeQty(index, delta) {
  if (!cart[index]) return;
  cart[index].quantity += delta;
  if (cart[index].quantity <= 0) {
    cart.splice(index, 1);
  }
  updateCartBadge();
  renderCart();
}

function removeItem(index) {
  if (!cart[index]) return;
  const removedName = cart[index].name;
  cart.splice(index, 1);
  updateCartBadge();
  renderCart();
  showToast(`Removed ${removedName} from bag`);
}

function renderCart() {
  const container = document.getElementById('cartItemsContainer');
  const subtotalBox = document.getElementById('cartSubtotalBox');
  const checkoutSection = document.getElementById('checkoutSection');

  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty-view">
        <p style="font-size:15px; margin-bottom:8px;">Your bag is empty.</p>
        <p style="font-size:12px; color:var(--grey);">Select a piece from Batch 002 above to order.</p>
      </div>
    `;
    if (subtotalBox) subtotalBox.style.display = 'none';
    if (checkoutSection) checkoutSection.style.display = 'none';
    return;
  }

  // Calculate totals
  let subtotal = 0;
  const itemsHtml = cart.map((item, index) => {
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;
    return `
      <div class="cart-item-card">
        <div style="flex:1;">
          <div class="cart-item-title">${escapeHtml(item.name)}</div>
          <div class="cart-item-meta">Size: <strong style="color:var(--ink);">${escapeHtml(item.size)}</strong> · Rs. ${item.price.toLocaleString('en-IN')} each</div>
          <div class="cart-qty-ctrl">
            <button type="button" class="cart-qty-btn" onclick="changeQty(${index}, -1)">−</button>
            <span class="cart-qty-val">${item.quantity}</span>
            <button type="button" class="cart-qty-btn" onclick="changeQty(${index}, 1)">+</button>
          </div>
        </div>
        <div style="text-align:right;">
          <button type="button" class="cart-item-del" onclick="removeItem(${index})" title="Remove item">✕</button>
          <div class="cart-item-price">Rs. ${itemTotal.toLocaleString('en-IN')}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="cart-items-list">${itemsHtml}</div>`;

  if (subtotalBox) {
    subtotalBox.style.display = 'block';
    document.getElementById('drawerSubtotal').textContent = `₹${subtotal.toLocaleString('en-IN')}`;
    document.getElementById('drawerTotal').textContent = `₹${subtotal.toLocaleString('en-IN')}`;
  }

  if (checkoutSection) {
    checkoutSection.style.display = 'block';
  }
}

// -------------------------------------------------------------
// CHECKOUT FORM SUBMISSION (Saves customer & order in SQLite DB)
// -------------------------------------------------------------
async function submitCheckout(e) {
  e.preventDefault();

  if (cart.length === 0) {
    showToast('Your bag is empty');
    return;
  }

  const name = document.getElementById('custName').value.trim();
  const email = document.getElementById('custEmail').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const city = document.getElementById('custCity').value.trim();
  const pincode = document.getElementById('custPincode').value.trim();
  const state = document.getElementById('custState').value.trim() || 'Punjab';
  const paymentMethod = document.getElementById('custPayment').value || 'COD';

  if (!name || !email || !address || !city) {
    showToast('Please fill in your delivery details');
    return;
  }

  const submitBtn = document.getElementById('checkoutSubmitBtn');
  const origBtnText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Locking In Order...';

  const orderPayload = {
    customer: {
      name,
      email,
      phone,
      address,
      city,
      state,
      pincode
    },
    items: cart.map(item => ({
      productName: item.name,
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.price
    })),
    paymentMethod,
    notes: 'Website storefront batch drop order'
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    const data = await res.json();

    if (data.success && data.order) {
      // Clear cart
      const placedOrder = data.order;
      const placedCustomer = data.customer;
      const placedItems = data.items || [];

      cart = [];
      updateCartBadge();
      renderCart();
      closeCart();

      // Show receipt modal
      const receiptContainer = document.getElementById('orderSuccessReceipt');
      if (receiptContainer) {
        const itemsList = placedItems.map(i => `
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>${escapeHtml(i.product_name)} (${i.size}) x ${i.quantity}</span>
            <span>₹${(i.total_price || 0).toLocaleString('en-IN')}</span>
          </div>
        `).join('');

        receiptContainer.innerHTML = `
          <div style="border-bottom:1px solid #131210; padding-bottom:8px; margin-bottom:10px;">
            <div style="font-weight:700; font-size:14px; color:var(--ink);">Order #${placedOrder.order_number}</div>
            <div style="color:var(--grey); font-size:11px;">Customer ID: #${placedCustomer.id} · ${escapeHtml(placedCustomer.name)}</div>
            <div style="color:var(--grey); font-size:11px;">Destination: ${escapeHtml(placedCustomer.city)}, ${escapeHtml(placedCustomer.state)} (${escapeHtml(placedCustomer.pincode)})</div>
          </div>
          ${itemsList}
          <div style="border-top:1px dashed #131210; padding-top:8px; margin-top:8px; display:flex; justify-content:space-between; font-weight:700;">
            <span>Total Payable (${placedOrder.payment_method})</span>
            <span>₹${(placedOrder.total_amount || 0).toLocaleString('en-IN')}</span>
          </div>
        `;
      }

      const successModal = document.getElementById('orderSuccessModal');
      if (successModal) successModal.classList.add('open');

      showToast(`Order confirmed! Saved in Repeat Cult customer database.`);
      document.getElementById('checkoutForm').reset();
    } else {
      showToast(data.error || 'Could not place order. Please check details.');
    }
  } catch (err) {
    console.error('Error submitting order:', err);
    showToast('Network error while recording order. Please ensure server is running.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = origBtnText;
  }
}

function closeOrderSuccessModal() {
  const modal = document.getElementById('orderSuccessModal');
  if (modal) modal.classList.remove('open');
}

// -------------------------------------------------------------
// UI HELPERS (Sizes, FAQ, Newsletter, Mobile menu)
// -------------------------------------------------------------
function pickSize(el) {
  const boxes = el.parentElement.querySelectorAll('.size-box');
  boxes.forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function toggleFaq(btn) {
  const item = btn.parentElement;
  const wasOpen = item.classList.contains('open');

  document.querySelectorAll('.faq-item').forEach(i => {
    i.classList.remove('open');
    i.querySelector('.faq-a').style.maxHeight = null;
  });

  if (!wasOpen) {
    item.classList.add('open');
    const a = item.querySelector('.faq-a');
    a.style.maxHeight = a.scrollHeight + 'px';
  }
}

// Init first open FAQ height
window.addEventListener('load', () => {
  const open = document.querySelector('.faq-item.open .faq-a');
  if (open) { open.style.maxHeight = open.scrollHeight + 'px'; }
});

async function joinList(e) {
  e.preventDefault();
  const form = e.target;
  const input = form.querySelector('input[type="email"]');
  const btn = form.querySelector('button[type="submit"]');
  const email = input.value.trim();

  if (!email) {
    showToast("Please enter a valid email");
    return false;
  }

  const origBtnText = btn.textContent;
  btn.textContent = "Locking in...";
  btn.disabled = true;

  try {
    const res = await fetch('/api/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: 'website_footer' })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message || "You're on the list — next batch alert is locked");
      form.reset();
    } else {
      showToast(data.error || "Could not register email");
    }
  } catch (err) {
    console.warn("Backend server not responding:", err);
    showToast("You're on the list — next batch alert is locked");
    form.reset();
  } finally {
    btn.textContent = origBtnText;
    btn.disabled = false;
  }

  return false;
}

// Mobile menu toggle
document.querySelector('.menu-toggle')?.addEventListener('click', () => {
  const nav = document.querySelector('nav.links') || document.querySelector('.links');
  if (nav) {
    if (nav.style.display === 'flex') {
      nav.style.display = 'none';
    } else {
      nav.style.display = 'flex';
      nav.style.flexDirection = 'column';
      nav.style.position = 'absolute';
      nav.style.top = '74px';
      nav.style.left = '0';
      nav.style.right = '0';
      nav.style.background = 'var(--paper)';
      nav.style.borderBottom = '2px solid var(--ink)';
      nav.style.padding = '12px 28px';
      nav.style.zIndex = '40';
    }
  }
});

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
