import { formatTimestamp } from './utils';

// Types
interface ProductSummary {
  commodity_code: string;
  product_name: string;
  price: number;
  available_stations: number;
  total_quantity: number;
  lines: string[];
}

interface Station {
  station_id: string;
  station_name: string;
  branch_name: string;
  quantity: number;
}

interface ProductDetail {
  product: ProductSummary;
  stations: Station[];
}

// State
let allProducts: ProductSummary[] = [];
let currentKeyword = '';
let currentLineFilter = 'all';
let allLines = new Set<string>();

// DOM Elements
const elements = {
  productGrid: document.getElementById('product-grid'),
  searchInput: document.getElementById('search-input') as HTMLInputElement,
  globalFilterContainer: document.getElementById('global-filter-container'),
  totalProducts: document.getElementById('total-products'),
  totalInventory: document.getElementById('total-inventory'),
  updateTime: document.getElementById('update-time'),
  template: document.getElementById('product-card-template') as HTMLTemplateElement,
  filterTemplate: document.getElementById('filter-tabs-template') as HTMLTemplateElement,
  
  // Modal Elements
  modalOverlay: document.getElementById('station-modal'),
  modalCloseBtn: document.querySelector('.modal-close'),
  modalTitle: document.querySelector('.modal-title'),
  modalFilterContainer: document.getElementById('modal-filter-container'),
  modalStationsList: document.getElementById('modal-stations-list'),
};

// Initialize
export async function initApp() {
  setupModal();
  await fetchAndRenderProducts();
  setupSearch();
  setupAutoRefresh();
}

// Fetch basic product list
async function fetchAndRenderProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error('API Error');
    const data = await res.json();
    const products: ProductSummary[] = data.products || data;
    
    // Sort by available stations (desc)
    products.sort((a, b) => b.available_stations - a.available_stations);
    allProducts = products;
    
    // Extract unique lines
    allLines.clear();
    products.forEach(p => p.lines?.forEach(l => allLines.add(l)));
    
    renderGlobalFilters();
    applyFilters();
    updateStats(products);
    updateTimestamp(data.last_updated);
  } catch (error) {
    console.error('Failed to fetch products:', error);
    if (elements.productGrid) {
      elements.productGrid.innerHTML = '<div class="error-msg">無法載入資料，請稍後再試。</div>';
    }
  }
}

// Global Filter UI
function renderGlobalFilters() {
  if (!elements.globalFilterContainer || !elements.filterTemplate) return;
  elements.globalFilterContainer.innerHTML = '';
  
  const clone = document.importNode(elements.filterTemplate.content, true);
  const tabsContainer = clone.querySelector('.filter-tabs');
  if (!tabsContainer) return;
  
  const allBtn = tabsContainer.querySelector('[data-filter="all"]');
  if (allBtn && currentLineFilter === 'all') allBtn.classList.add('active');
  else if (allBtn) allBtn.classList.remove('active');
  
  // Sorted lines
  Array.from(allLines).sort().forEach(line => {
    const btn = document.createElement('button');
    btn.className = `filter-pill ${currentLineFilter === line ? 'active' : ''}`;
    btn.dataset.filter = line;
    btn.textContent = line;
    tabsContainer.appendChild(btn);
  });
  
  // Event Delegation for tabs
  tabsContainer.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('filter-pill')) {
      const filterValue = target.dataset.filter || 'all';
      currentLineFilter = filterValue;
      renderGlobalFilters(); // re-render to update active class
      applyFilters();
    }
  });
  
  elements.globalFilterContainer.appendChild(clone);
}

// Apply both search and line filter
function applyFilters() {
  let filtered = allProducts;
  
  if (currentKeyword) {
    filtered = filtered.filter(p => p.product_name.toLowerCase().includes(currentKeyword));
  }
  
  if (currentLineFilter !== 'all') {
    filtered = filtered.filter(p => p.lines?.includes(currentLineFilter));
  }
  
  renderProducts(filtered);
}

// Render products
function renderProducts(products: ProductSummary[]) {
  if (!elements.productGrid || !elements.template) return;
  
  elements.productGrid.innerHTML = '';
  
  if (products.length === 0) {
    elements.productGrid.innerHTML = '<div class="empty-msg">找不到符合的商品</div>';
    return;
  }
  
  products.forEach(product => {
    const clone = document.importNode(elements.template.content, true);
    
    const nameEl = clone.querySelector('.product-name');
    const priceEl = clone.querySelector('.product-price');
    const countEl = clone.querySelector('.stock-count');
    const btnEl = clone.querySelector('.view-stock-btn');
    
    if (nameEl) nameEl.textContent = product.product_name;
    if (priceEl) priceEl.textContent = `$${product.price}`;
    if (countEl) countEl.textContent = product.available_stations.toString();
    
    const cardEl = clone.querySelector('.product-card') as HTMLElement;
    
    if (cardEl) {
      if (product.available_stations === 0) {
        cardEl.style.opacity = '0.6';
        cardEl.style.cursor = 'not-allowed';
        if (btnEl) {
          (btnEl as HTMLButtonElement).disabled = true;
          (btnEl.querySelector('span') as HTMLElement).textContent = '暫無庫存';
        }
      } else {
        cardEl.addEventListener('click', () => {
             openStationModal(product.commodity_code, product.product_name);
        });
      }
    }
    
    if (elements.productGrid) {
      elements.productGrid.appendChild(clone);
    }
  });
}

// Setup Modal bindings
function setupModal() {
    if (!elements.modalOverlay) return;

    const closeHandler = () => {
        elements.modalOverlay?.classList.add('hidden');
        document.body.classList.remove('no-scroll');
    };

    elements.modalCloseBtn?.addEventListener('click', closeHandler);
    elements.modalOverlay.addEventListener('click', (e) => {
        if (e.target === elements.modalOverlay) closeHandler();
    });

    // Touch events for bottom sheet swipe down
    let startY = 0;
    elements.modalOverlay.querySelector('.modal-dialog')?.addEventListener('touchstart', (e) => {
        startY = (e as TouchEvent).touches[0].clientY;
    }, {passive: true});

    elements.modalOverlay.querySelector('.modal-dialog')?.addEventListener('touchend', (e) => {
        const endY = (e as TouchEvent).changedTouches[0].clientY;
        if (endY - startY > 100) { // Swipe down threshold
            closeHandler();
        }
    }, {passive: true});
}

function openStationModal(code: string, name: string) {
    if (!elements.modalOverlay || !elements.modalTitle || !elements.modalStationsList) return;
    
    elements.modalTitle.textContent = name;
    elements.modalOverlay.classList.remove('hidden');
    document.body.classList.add('no-scroll');
    
    loadProductDetailForModal(code);
}

async function loadProductDetailForModal(code: string) {
    const listEl = elements.modalStationsList!;
    const filterEl = elements.modalFilterContainer!;
    
    listEl.innerHTML = '<div class="stations-loading"><div class="loading-row"></div><div class="loading-row"></div></div>';
    filterEl.innerHTML = '';
    
    try {
      const res = await fetch(`/api/products/${code}`);
      if (!res.ok) throw new Error('API Error');
      const detail: ProductDetail = await res.json();
      
      listEl.innerHTML = '';
      
      if (!detail.stations || detail.stations.length === 0) {
        listEl.innerHTML = '<div class="line-group"><div class="station-item" style="color: var(--color-text-muted)">目前無庫存</div></div>';
        return;
      }
      
      // Group by branch_name
      const groups: Record<string, Station[]> = {};
      detail.stations.forEach((st: Station) => {
        const line = st.branch_name || '其他';
        if (!groups[line]) groups[line] = [];
        groups[line].push(st);
      });

      // Render Modal Filter Tabs
      if (elements.filterTemplate) {
          const clone = document.importNode(elements.filterTemplate.content, true);
          const tabsContainer = clone.querySelector('.filter-tabs');
          if (tabsContainer) {
              const lines = Object.keys(groups).sort();
              lines.forEach(line => {
                  const btn = document.createElement('button');
                  btn.className = 'filter-pill';
                  btn.dataset.filter = line;
                  btn.textContent = line;
                  tabsContainer.appendChild(btn);
              });
              
              tabsContainer.addEventListener('click', (e) => {
                  const target = e.target as HTMLElement;
                  if (target.classList.contains('filter-pill')) {
                      // Update active states
                      tabsContainer.querySelectorAll('.filter-pill').forEach(el => el.classList.remove('active'));
                      target.classList.add('active');
                      
                      const selectedLine = target.dataset.filter || 'all';
                      
                      // Filter the DOM elements
                      listEl.querySelectorAll('.line-group').forEach(group => {
                          const g = group as HTMLElement;
                          if (selectedLine === 'all' || g.dataset.line === selectedLine) {
                              g.style.display = 'block';
                          } else {
                              g.style.display = 'none';
                          }
                      });
                  }
              });
              filterEl.appendChild(clone);
          }
      }

      // Render Stations
      for (const [lineName, stations] of Object.entries(groups)) {
        const groupEl = document.createElement('div');
        groupEl.className = 'line-group';
        groupEl.dataset.line = lineName;
        
        const titleEl = document.createElement('div');
        titleEl.className = 'line-name';
        titleEl.textContent = lineName;
        groupEl.appendChild(titleEl);
        
        stations.forEach((st: Station) => {
          const stEl = document.createElement('div');
          stEl.className = 'station-item';
          stEl.innerHTML = `
            <span class="station-name">${st.station_name}</span>
            <span class="station-stock">${st.quantity} 條</span>
          `;
          groupEl.appendChild(stEl);
        });
        
        listEl.appendChild(groupEl);
      }
      
    } catch (error) {
      listEl.innerHTML = '<div class="line-group"><div class="station-item" style="color: var(--color-brand)">載入庫存失敗</div></div>';
    }
}

// Update Global Stats
function updateStats(products: ProductSummary[]) {
  if (elements.totalProducts) {
    const availableProductsCount = products.filter(p => p.available_stations > 0).length;
    elements.totalProducts.textContent = availableProductsCount.toString();
  }
  
  if (elements.totalInventory) {
    const sumInventory = products.reduce((acc, p) => acc + p.available_stations, 0);
    elements.totalInventory.textContent = sumInventory.toString();
  }
}

// Update Timestamp
function updateTimestamp(serverTime: string | null) {
  if (elements.updateTime) {
    elements.updateTime.textContent = formatTimestamp(serverTime);
  }
}

// Setup Search Filter
function setupSearch() {
  if (!elements.searchInput) return;
  
  elements.searchInput.addEventListener('input', (e) => {
    currentKeyword = (e.target as HTMLInputElement).value.toLowerCase().trim();
    applyFilters();
  });
}

// Setup Auto Refresh (10 mins)
function setupAutoRefresh() {
  setInterval(() => {
    fetchAndRenderProducts();
  }, 10 * 60 * 1000);
}
