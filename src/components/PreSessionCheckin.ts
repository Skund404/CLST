/**
 * Pre-Session Check-In Component for CLST
 * Implements Section 4 (PRE-SESSION CHECK-IN) of the specification
 * Vanilla TypeScript - no framework dependencies
 */

import type { PreSessionCheckin } from '@/types';

export interface CheckinOptions {
  previousCheckin?: PreSessionCheckin | null;
  symptomHistory?: string[];
  onComplete?: (checkin: PreSessionCheckin | null) => void;
}

export class CheckinComponent {
  private container: HTMLElement;
  private options: CheckinOptions;
  private formData: Partial<PreSessionCheckin>;
  private symptomSuggestions: string[];

  constructor(container: HTMLElement, options: CheckinOptions = {}) {
    this.container = container;
    this.options = options;
    this.formData = this.initializeFromPrevious(options.previousCheckin);
    this.symptomSuggestions = options.symptomHistory || [];
  }

  /**
   * Initialize form data from previous session
   */
  private initializeFromPrevious(previous?: PreSessionCheckin | null): Partial<PreSessionCheckin> {
    if (!previous) {
      return {
        sleepQuality: null,
        currentState: null,
        symptomSeverity: null,
        symptomLabel: null,
        medicationStatus: null,
        stressLevel: null,
        substances: [],
        freeNotes: null
      };
    }

    // Pre-fill from last session
    return {
      sleepQuality: previous.sleepQuality,
      currentState: previous.currentState,
      symptomSeverity: previous.symptomSeverity,
      symptomLabel: previous.symptomLabel,
      medicationStatus: previous.medicationStatus,
      stressLevel: previous.stressLevel,
      substances: [...previous.substances],
      freeNotes: null // Don't pre-fill notes
    };
  }

  /**
   * Render the check-in form
   */
  render(): void {
    this.container.innerHTML = `
      <div class="checkin-container">
        <div class="checkin-header">
          <h2>Pre-Session Check-In</h2>
          <p class="checkin-subtitle">How are you feeling? (All questions optional)</p>
        </div>

        <form class="checkin-form" id="checkin-form">
          <!-- Q1: Sleep Quality -->
          <div class="checkin-question">
            <label class="checkin-label">How did you sleep?</label>
            <div class="checkin-scale" data-question="sleepQuality">
              ${this.renderScale(1, 5, ['Terrible', 'Poor', 'Okay', 'Good', 'Great'], this.formData.sleepQuality)}
            </div>
          </div>

          <!-- Q2: Current State -->
          <div class="checkin-question">
            <label class="checkin-label">How are you feeling right now?</label>
            <div class="checkin-scale" data-question="currentState">
              ${this.renderScale(1, 5, ['Terrible', 'Off', 'Okay', 'Good', 'Excellent'], this.formData.currentState)}
            </div>
          </div>

          <!-- Q3: Symptoms -->
          <div class="checkin-question">
            <label class="checkin-label">Any symptoms right now?</label>
            <div class="checkin-scale" data-question="symptomSeverity">
              ${this.renderScale(0, 3, ['None', 'Mild', 'Moderate', 'Severe'], this.formData.symptomSeverity)}
            </div>
            <div class="symptom-label-container" id="symptom-label-container" style="${(this.formData.symptomSeverity ?? 0) > 0 ? '' : 'display: none;'}">
              <input 
                type="text" 
                id="symptom-label" 
                class="checkin-input symptom-label-input"
                placeholder="e.g., migraine, brain fog, headache, fatigue..."
                value="${this.formData.symptomLabel || ''}"
                autocomplete="off"
              />
              <div class="symptom-suggestions" id="symptom-suggestions"></div>
            </div>
          </div>

          <!-- Q4: Medication Status -->
          <div class="checkin-question">
            <label class="checkin-label">Medication status?</label>
            <select id="medication-status" class="checkin-select">
              <option value="">Select...</option>
              <option value="as_usual" ${this.formData.medicationStatus === 'as_usual' ? 'selected' : ''}>As usual</option>
              <option value="late" ${this.formData.medicationStatus === 'late' ? 'selected' : ''}>Late</option>
              <option value="missed" ${this.formData.medicationStatus === 'missed' ? 'selected' : ''}>Missed</option>
              <option value="changed" ${this.formData.medicationStatus === 'changed' ? 'selected' : ''}>Changed</option>
              <option value="na" ${this.formData.medicationStatus === 'na' ? 'selected' : ''}>N/A</option>
            </select>
          </div>

          <!-- Q5: Stress Level -->
          <div class="checkin-question">
            <label class="checkin-label">Stress level?</label>
            <div class="checkin-scale" data-question="stressLevel">
              ${this.renderScale(1, 5, ['Relaxed', 'Mild', 'Moderate', 'High', 'Overwhelmed'], this.formData.stressLevel)}
            </div>
          </div>

          <!-- Q6: Substances -->
          <div class="checkin-question">
            <label class="checkin-label">Consumed today?</label>
            <div class="checkin-multiselect">
              ${this.renderMultiSelect(['None', 'Caffeine', 'Alcohol', 'Cannabis', 'Other'], this.formData.substances || [])}
            </div>
          </div>

          <!-- Free-text notes -->
          <div class="checkin-question">
            <label class="checkin-label">Additional notes (optional)</label>
            <textarea 
              id="free-notes" 
              class="checkin-textarea"
              placeholder="e.g., '4 hours post-seizure', 'new medication day 3', 'double espresso'..."
              rows="3"
            >${this.formData.freeNotes || ''}</textarea>
          </div>

          <!-- Action buttons -->
          <div class="checkin-actions">
            <button type="button" id="skip-button" class="checkin-button checkin-button-secondary">
              Skip Check-In
            </button>
            <button type="submit" class="checkin-button checkin-button-primary">
              Continue to Test
            </button>
          </div>
        </form>
      </div>
    `;

    this.attachEventListeners();
  }

  /**
   * Render a scale input (1-5 or 0-3)
   */
  private renderScale(min: number, max: number, labels: string[], selected: number | null): string {
    const options = [];
    
    for (let i = min; i <= max; i++) {
      const label = labels[i - min];
      const isSelected = selected === i;
      
      options.push(`
        <button 
          type="button" 
          class="scale-option ${isSelected ? 'scale-option-selected' : ''}" 
          data-value="${i}"
        >
          <span class="scale-label">${label}</span>
        </button>
      `);
    }

    return options.join('');
  }

  /**
   * Render multi-select checkboxes
   */
  private renderMultiSelect(options: string[], selected: string[]): string {
    return options.map(option => {
      const value = option.toLowerCase();
      const isSelected = selected.includes(value);
      
      return `
        <label class="multiselect-option">
          <input 
            type="checkbox" 
            name="substances" 
            value="${value}"
            ${isSelected ? 'checked' : ''}
          />
          <span class="multiselect-label">${option}</span>
        </label>
      `;
    }).join('');
  }

  /**
   * Attach event listeners
   */
  private attachEventListeners(): void {
    const form = this.container.querySelector('#checkin-form') as HTMLFormElement;
    const skipButton = this.container.querySelector('#skip-button') as HTMLButtonElement;

    // Form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    // Skip button
    skipButton.addEventListener('click', () => {
      this.handleSkip();
    });

    // Scale selections
    const scales = this.container.querySelectorAll('.checkin-scale');
    scales.forEach(scale => {
      scale.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest('.scale-option') as HTMLButtonElement;
        
        if (button) {
          this.handleScaleSelection(scale as HTMLElement, button);
        }
      });
    });

    // Symptom severity - show/hide label input
    const symptomScale = this.container.querySelector('[data-question="symptomSeverity"]');
    if (symptomScale) {
      symptomScale.addEventListener('click', () => {
        setTimeout(() => this.updateSymptomLabelVisibility(), 0);
      });
    }

    // Symptom label autocomplete
    const symptomInput = this.container.querySelector('#symptom-label') as HTMLInputElement;
    if (symptomInput) {
      symptomInput.addEventListener('input', (e) => {
        this.handleSymptomInput((e.target as HTMLInputElement).value);
      });

      symptomInput.addEventListener('blur', () => {
        // Delay to allow clicking suggestions
        setTimeout(() => this.hideSuggestions(), 200);
      });
    }

    // Medication dropdown
    const medSelect = this.container.querySelector('#medication-status') as HTMLSelectElement;
    if (medSelect) {
      medSelect.addEventListener('change', (e) => {
        const value = (e.target as HTMLSelectElement).value;
        this.formData.medicationStatus = value || null;
      });
    }

    // Substances checkboxes
    const substanceCheckboxes = this.container.querySelectorAll('input[name="substances"]');
    substanceCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        this.updateSubstances();
      });
    });

    // Free notes
    const notesArea = this.container.querySelector('#free-notes') as HTMLTextAreaElement;
    if (notesArea) {
      notesArea.addEventListener('input', (e) => {
        this.formData.freeNotes = (e.target as HTMLTextAreaElement).value || null;
      });
    }
  }

  /**
   * Handle scale selection
   */
  private handleScaleSelection(scale: HTMLElement, button: HTMLButtonElement): void {
    const question = scale.dataset.question as keyof PreSessionCheckin;
    const value = parseInt(button.dataset.value || '0');

    // Update selection state
    const allOptions = scale.querySelectorAll('.scale-option');
    allOptions.forEach(opt => opt.classList.remove('scale-option-selected'));
    button.classList.add('scale-option-selected');

    // Update form data
    (this.formData as any)[question] = value;
  }

  /**
   * Update symptom label field visibility
   */
  private updateSymptomLabelVisibility(): void {
    const container = this.container.querySelector('#symptom-label-container') as HTMLElement;
    const severity = this.formData.symptomSeverity ?? 0;

    if (severity > 0) {
      container.style.display = 'block';
      const input = this.container.querySelector('#symptom-label') as HTMLInputElement;
      input.focus();
    } else {
      container.style.display = 'none';
      this.formData.symptomLabel = null;
    }
  }

  /**
   * Handle symptom input with autocomplete
   */
  private handleSymptomInput(value: string): void {
    this.formData.symptomLabel = value || null;

    if (!value || value.length < 2) {
      this.hideSuggestions();
      return;
    }

    // Filter suggestions
    const matches = this.symptomSuggestions.filter(s => 
      s.toLowerCase().includes(value.toLowerCase())
    ).slice(0, 5); // Max 5 suggestions

    if (matches.length === 0) {
      this.hideSuggestions();
      return;
    }

    this.showSuggestions(matches);
  }

  /**
   * Show symptom suggestions
   */
  private showSuggestions(suggestions: string[]): void {
    const container = this.container.querySelector('#symptom-suggestions') as HTMLElement;
    
    container.innerHTML = suggestions.map(s => `
      <div class="symptom-suggestion" data-value="${s}">${s}</div>
    `).join('');

    container.style.display = 'block';

    // Attach click handlers
    const suggestionElements = container.querySelectorAll('.symptom-suggestion');
    suggestionElements.forEach(el => {
      el.addEventListener('click', () => {
        const value = (el as HTMLElement).dataset.value || '';
        const input = this.container.querySelector('#symptom-label') as HTMLInputElement;
        input.value = value;
        this.formData.symptomLabel = value;
        this.hideSuggestions();
      });
    });
  }

  /**
   * Hide symptom suggestions
   */
  private hideSuggestions(): void {
    const container = this.container.querySelector('#symptom-suggestions') as HTMLElement;
    if (container) {
      container.style.display = 'none';
    }
  }

  /**
   * Update substances from checkboxes
   */
  private updateSubstances(): void {
    const checkboxes = this.container.querySelectorAll('input[name="substances"]:checked');
    const values = Array.from(checkboxes).map(cb => (cb as HTMLInputElement).value);
    
    // Handle "None" exclusivity
    if (values.includes('none')) {
      this.formData.substances = ['none'];
      // Uncheck all others
      const allCheckboxes = this.container.querySelectorAll('input[name="substances"]');
      allCheckboxes.forEach(cb => {
        const input = cb as HTMLInputElement;
        if (input.value !== 'none') {
          input.checked = false;
        }
      });
    } else {
      this.formData.substances = values;
    }
  }

  /**
   * Handle form submission
   */
  private handleSubmit(): void {
    const checkin: PreSessionCheckin = {
      id: this.generateId(),
      sleepQuality: this.formData.sleepQuality ?? null,
      currentState: this.formData.currentState ?? null,
      symptomSeverity: this.formData.symptomSeverity ?? null,
      symptomLabel: this.formData.symptomLabel ?? null,
      medicationStatus: (this.formData.medicationStatus as any) ?? null,
      stressLevel: this.formData.stressLevel ?? null,
      substances: this.formData.substances || [],
      freeNotes: this.formData.freeNotes ?? null
    };

    if (this.options.onComplete) {
      this.options.onComplete(checkin);
    }
  }

  /**
   * Handle skip button
   */
  private handleSkip(): void {
    if (this.options.onComplete) {
      this.options.onComplete(null);
    }
  }

  /**
   * Get current form value
   */
  getValue(): PreSessionCheckin | null {
    return {
      id: this.generateId(),
      sleepQuality: this.formData.sleepQuality ?? null,
      currentState: this.formData.currentState ?? null,
      symptomSeverity: this.formData.symptomSeverity ?? null,
      symptomLabel: this.formData.symptomLabel ?? null,
      medicationStatus: (this.formData.medicationStatus as any) ?? null,
      stressLevel: this.formData.stressLevel ?? null,
      substances: this.formData.substances || [],
      freeNotes: this.formData.freeNotes ?? null
    };
  }

  /**
   * Generate UUID v4
   */
  private generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Destroy component
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
