import { appCore } from './core.js';
import { state } from './state/index.js';
import { updateCardsForBulkMode } from './components/shared/ModelCard.js';
import { createPageControls } from './components/controls/index.js';
import { confirmDelete, closeDeleteModal, confirmExclude, closeExcludeModal } from './utils/modalUtils.js';
import { ModelDuplicatesManager } from './components/ModelDuplicatesManager.js';
import { initActiveFiltersSync } from './utils/activeFiltersSync.js';

// Initialize the LoRA page
export class LoraPageManager {
    constructor() {
        // Add bulk mode to state
        state.bulkMode = false;
        state.selectedLoras = new Set();
        
        // Initialize page controls
        this.pageControls = createPageControls('loras');
        
        // Initialize the ModelDuplicatesManager
        this.duplicatesManager = new ModelDuplicatesManager(this);
        
        // Expose necessary functions to the page that still need global access
        // These will be refactored in future updates
        this._exposeRequiredGlobalFunctions();
    }
    
    _exposeRequiredGlobalFunctions() {
        // Only expose what's still needed globally
        // Most functionality is now handled by the PageControls component
        window.confirmDelete = confirmDelete;
        window.closeDeleteModal = closeDeleteModal;
        window.confirmExclude = confirmExclude;
        window.closeExcludeModal = closeExcludeModal;
        
        // Expose duplicates manager
        window.modelDuplicatesManager = this.duplicatesManager;
    }
    
    async initialize() {
        // Initialize cards for current bulk mode state (should be false initially)
        updateCardsForBulkMode(state.bulkMode);

        // Initialize common page features (including context menus and virtual scroll)
        appCore.initializePageFeatures();

        // Mirror active filters to the backend for the ComfyUI-side autocomplete
        initActiveFiltersSync('loras');
    }
}

export async function initializeLoraPage() {
    // Initialize core application
    await appCore.initialize();

    // Initialize page-specific functionality
    const loraPage = new LoraPageManager();
    await loraPage.initialize();

    // A workflow sidebar Info link opens the exact local copy in the full manager.
    const params = new URLSearchParams(window.location.search);
    const filePath = params.get('model');
    if (filePath) {
        const query = new URLSearchParams({ page_size: '100' });
        if (params.get('hash')) query.set('hash', params.get('hash'));
        else query.set('search', filePath.split(/[/\\]/).pop());
        try {
            const response = await fetch(`/api/lm/loras/list?${query}`);
            if (!response.ok) throw new Error(`Library request failed (${response.status})`);
            const data = await response.json();
            const model = data.items.find(item => item.file_path.replaceAll('\\', '/') === filePath.replaceAll('\\', '/'));
            if (model) {
                const { showModelModal } = await import('./components/shared/ModelModal.js');
                await showModelModal(model, 'loras');
            }
        } catch (error) {
            console.warn('Could not open linked LoRA details:', error);
        }
    }

    return loraPage;
}

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', initializeLoraPage);
