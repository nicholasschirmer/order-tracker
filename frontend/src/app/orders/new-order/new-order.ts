import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { OrderService } from '../order.service';
import { ProblemDetails } from '../order.model';

/** `Validators.required` accepts whitespace; reps sometimes tab through fields with a space. */
function notBlank(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  return typeof value === 'string' && value.trim().length === 0 ? { required: true } : null;
}

type LineGroup = FormGroup<{
  product: ReturnType<FormBuilder['control']>;
  quantity: ReturnType<FormBuilder['control']>;
  unitPrice: ReturnType<FormBuilder['control']>;
}>;

@Component({
  selector: 'app-new-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, DecimalPipe],
  templateUrl: './new-order.html',
  styleUrl: './new-order.css',
})
export class NewOrder {
  private readonly fb = inject(FormBuilder);
  private readonly orders = inject(OrderService);
  private readonly router = inject(Router);

  readonly form = this.fb.group({
    clientReference: this.fb.control('', [Validators.required, notBlank, Validators.maxLength(64)]),
    customerName: this.fb.control('', [Validators.required, notBlank, Validators.maxLength(200)]),
    lines: this.fb.array<LineGroup>([this.newLine()], [Validators.required, Validators.minLength(1)]),
  });

  readonly submitting = signal(false);
  readonly conflict = signal<ProblemDetails | null>(null);
  readonly error = signal<string | null>(null);

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  readonly runningTotal = computed(() =>
    (this.formValue()?.lines ?? []).reduce(
      (sum, line) => sum + (Number(line?.quantity) || 0) * (Number(line?.unitPrice) || 0),
      0,
    ),
  );

  get lines(): FormArray<LineGroup> {
    return this.form.controls.lines;
  }

  lineTotal(line: LineGroup): number {
    return (Number(line.value.quantity) || 0) * (Number(line.value.unitPrice) || 0);
  }

  addLine(): void {
    this.lines.push(this.newLine());
  }

  removeLine(index: number): void {
    if (this.lines.length > 1) this.lines.removeAt(index);
  }

  /** Message for a control, or null when it is valid or not yet touched/dirty. */
  errorFor(control: AbstractControl | null, label: string): string | null {
    if (!control || control.valid || !(control.touched || control.dirty)) return null;
    if (control.hasError('required')) return `${label} is required.`;
    if (control.hasError('maxlength')) return `${label} is too long.`;
    if (control.hasError('min')) {
      return label === 'Quantity' ? 'Quantity must be greater than zero.' : 'Unit price cannot be negative.';
    }
    return `${label} is invalid.`;
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const request = {
      clientReference: raw.clientReference!.trim(),
      customerName: raw.customerName!.trim(),
      lines: raw.lines.map((l) => ({
        product: String(l.product ?? '').trim(),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
      })),
    };

    this.submitting.set(true);
    this.conflict.set(null);
    this.error.set(null);

    this.orders.create(request).subscribe({
      next: (outcome) => {
        this.submitting.set(false);
        switch (outcome.kind) {
          case 'created':
            void this.router.navigate(['/orders', outcome.order.id], { queryParams: { notice: 'created' } });
            break;
          case 'replayed':
            void this.router.navigate(['/orders', outcome.order.id], { queryParams: { notice: 'replayed' } });
            break;
          case 'conflict':
            this.conflict.set(outcome.problem);
            break;
        }
      },
      error: () => {
        this.submitting.set(false);
        this.error.set('The order could not be submitted. Please try again in a moment.');
      },
    });
  }

  private newLine(): LineGroup {
    return this.fb.group({
      product: this.fb.control('', [Validators.required, notBlank, Validators.maxLength(200)]),
      quantity: this.fb.control<number | null>(1, [Validators.required, Validators.min(1)]),
      unitPrice: this.fb.control<number | null>(null, [Validators.required, Validators.min(0)]),
    }) as LineGroup;
  }
}
