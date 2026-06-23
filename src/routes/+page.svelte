<script lang="ts">
	import { appState } from '$lib/store.svelte';
	import { interpolateLMS, calculateZScore, zToPercentile, type LMSEntry } from '$lib/lms';

	// Import parsed WHO datasets
	import wfaBoys from '$lib/data/who/wfa_boys.json';
	import wfaGirls from '$lib/data/who/wfa_girls.json';
	import lhfaBoys from '$lib/data/who/lhfa_boys.json';
	import lhfaGirls from '$lib/data/who/lhfa_girls.json';
	import hcfaBoys from '$lib/data/who/hcfa_boys.json';
	import hcfaGirls from '$lib/data/who/hcfa_girls.json';
	import wflBoys from '$lib/data/who/wfl_boys.json';
	import wflGirls from '$lib/data/who/wfl_girls.json';

	const boysData: Record<string, any> = {
		wfa: wfaBoys,
		lhfa: lhfaBoys,
		hcfa: hcfaBoys,
		wfl: wflBoys
	};

	const girlsData: Record<string, any> = {
		wfa: wfaGirls,
		lhfa: lhfaGirls,
		hcfa: hcfaGirls,
		wfl: wflGirls
	};

	// UI State
	let activeTab = $state<'wfa' | 'lhfa' | 'hcfa' | 'wfl'>('wfa');
	let selectedRange = $state<'1yr' | '2yr' | '5yr'>('1yr'); // Applicable only to month-view

	// Form input bindings
	let inputAge = $state<number | null>(null);
	let inputWeight = $state<number | null>(null);
	let inputLength = $state<number | null>(null);
	let inputHC = $state<number | null>(null);
	let formError = $state<string>('');

	// Interactive hover details for chart
	let hoveredPoint = $state<{
		age: number;
		ageUnit: 'weeks' | 'months';
		val: number;
		metric: 'wfa' | 'lhfa' | 'hcfa' | 'wfl';
		z: number;
		pct: number;
	} | null>(null);

	// Helper to resolve the active WHO dataset based on selected gender, metric, and unit
	function getActiveWHODataset(metric: string, gender: 'boy' | 'girl', unit: 'weeks' | 'months') {
		const dataGroup = gender === 'boy' ? boysData[metric] : girlsData[metric];
		if (!dataGroup) return [];

		if (metric === 'wfl') {
			const part1 = dataGroup.length_0to2 || [];
			const part2 = dataGroup.height_2to5 || [];
			const combined = [...part1];
			const lengths = new Set(part1.map((e: any) => e.x));
			for (const entry of part2) {
				if (!lengths.has(entry.x)) {
					combined.push(entry);
				}
			}
			return combined.sort((a, b) => a.x - b.x);
		}

		if (unit === 'weeks') {
			return dataGroup.weeks || [];
		} else {
			if (metric === 'lhfa') {
				const part1 = dataGroup.months_0to2 || [];
				const part2 = dataGroup.months_2to5 || [];
				const combined = [...part1];
				const months = new Set(part1.map((e: any) => e.x));
				for (const entry of part2) {
					if (!months.has(entry.x)) {
						combined.push(entry);
					}
				}
				return combined.sort((a, b) => a.x - b.x);
			} else {
				return dataGroup.months || [];
			}
		}
	}

	// Reactive computed variables
	let activeWHODataset = $derived(
		getActiveWHODataset(activeTab, appState.gender, appState.ageUnit)
	);

	// Determine active x range for plotting
	let xRange = $derived.by(() => {
		if (activeTab === 'wfl') {
			return { min: 45, max: 120 };
		}
		if (appState.ageUnit === 'weeks') {
			return { min: 0, max: 13 };
		}
		if (selectedRange === '1yr') return { min: 0, max: 12 };
		if (selectedRange === '2yr') return { min: 0, max: 24 };
		return { min: 0, max: 60 };
	});

	// Filter dataset to fit inside the active range
	let filteredWHODataset = $derived(
		activeWHODataset.filter((e: any) => e.x >= xRange.min && e.x <= xRange.max)
	);

	// Compute y-axis limits dynamically based on WHO curves in range and child measurements
	let yRange = $derived.by(() => {
		if (filteredWHODataset.length === 0) return { min: 0, max: 10 };

		let yMin = Math.min(...filteredWHODataset.map((e: any) => e.sd3neg));
		let yMax = Math.max(...filteredWHODataset.map((e: any) => e.sd3));

		const childPoints = childPlotPoints;
		if (childPoints.length > 0) {
			const childYVals = childPoints.map((p) => p.y).filter((y) => y !== null) as number[];
			if (childYVals.length > 0) {
				yMin = Math.min(yMin, ...childYVals);
				yMax = Math.max(yMax, ...childYVals);
			}
		}

		const span = yMax - yMin;
		return {
			min: Math.max(0, yMin - span * 0.05),
			max: yMax + span * 0.05
		};
	});

	// Child plot points mapped to (x, y) coordinates based on active tab
	let childPlotPoints = $derived.by(() => {
		return appState.measurements
			.map((m) => {
				let x = 0;
				let y: number | null = null;

				if (activeTab === 'wfl') {
					x = m.length || 0;
					y = m.weight;
				} else {
					x = appState.ageUnit === 'weeks' ? m.ageWeeks : m.ageMonths;
					if (activeTab === 'wfa') y = m.weight;
					else if (activeTab === 'lhfa') y = m.length;
					else if (activeTab === 'hcfa') y = m.hc;
				}

				const inRange = x >= xRange.min && x <= xRange.max;
				return { id: m.id, raw: m, x, y, inRange };
			})
			.filter((p) => p.y !== null && p.x > 0);
	});

	// SVG parameters
	const svgW = 800;
	const svgH = 550;
	const padL = 65;
	const padR = 50;
	const padT = 30;
	const padB = 60;

	// Coordinate projection helpers
	function projectX(x: number) {
		return padL + ((x - xRange.min) / (xRange.max - xRange.min)) * (svgW - padL - padR);
	}

	function projectY(y: number) {
		return svgH - padB - ((y - yRange.min) / (yRange.max - yRange.min)) * (svgH - padT - padB);
	}

	// Generate SVG path for a given WHO z-score line key
	function getCurvePath(key: string) {
		if (filteredWHODataset.length === 0) return '';
		return filteredWHODataset
			.map((e: any, index: number) => {
				const x = projectX(e.x);
				const y = projectY(e[key]);
				return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
			})
			.join(' ');
	}

	// Generate SVG path for shaded bands (e.g., between -2 SD and +2 SD)
	function getShadedBandPath(lowKey: string, highKey: string) {
		if (filteredWHODataset.length === 0) return '';
		const pointsLow = filteredWHODataset.map((e: any) => ({
			x: projectX(e.x),
			y: projectY(e[lowKey])
		}));
		const pointsHigh = filteredWHODataset.map((e: any) => ({
			x: projectX(e.x),
			y: projectY(e[highKey])
		}));

		const forward = pointsLow.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
		const backward = [...pointsHigh]
			.reverse()
			.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
			.join(' ');

		return `M ${forward} L ${backward} Z`;
	}

	// Get localized label for Y axis
	function getYLabel(tab: typeof activeTab) {
		switch (tab) {
			case 'wfa':
				return 'Vikt (kg)';
			case 'lhfa':
				return 'Längd/Höjd (cm)';
			case 'hcfa':
				return 'Huvudomfång (cm)';
			case 'wfl':
				return 'Vikt (kg)';
		}
	}

	// Get localized label for X axis
	function getXLabel() {
		if (activeTab === 'wfl') return 'Längd (cm)';
		return appState.ageUnit === 'weeks' ? 'Ålder (veckor)' : 'Ålder (månader)';
	}

	// Format Z-score text with correct sign
	function formatZ(z: number) {
		return (z >= 0 ? '+' : '') + z.toFixed(2);
	}

	// Calculate LMS details for specific measurement point to display in table/info
	function getPointLMS(m: any, metric: typeof activeTab) {
		const rawVal =
			metric === 'wfa'
				? m.weight
				: metric === 'lhfa'
					? m.length
					: metric === 'hcfa'
						? m.hc
						: m.weight;
		const xVal =
			metric === 'wfl' ? m.length || 0 : appState.ageUnit === 'weeks' ? m.ageWeeks : m.ageMonths;

		if (rawVal === null || xVal <= 0) return null;

		const genderData = appState.gender === 'boy' ? boysData[metric] : girlsData[metric];
		if (!genderData) return null;

		let entries: LMSEntry[] = [];
		if (metric === 'wfl') {
			entries =
				xVal < 86 ? genderData.length_0to2 : genderData.height_2to5 || genderData.length_0to2;
		} else {
			if (appState.ageUnit === 'weeks') {
				entries = genderData.weeks || [];
			} else {
				entries =
					metric === 'lhfa'
						? xVal <= 24
							? genderData.months_0to2
							: genderData.months_2to5
						: genderData.months || [];
			}
		}

		if (entries.length === 0) return null;
		try {
			const interpolated = interpolateLMS(entries, xVal);
			const z = calculateZScore(rawVal, interpolated.l, interpolated.m, interpolated.s);
			const pct = zToPercentile(z);
			return { z, pct };
		} catch (e) {
			return null;
		}
	}

	// Handle adding measurement from form
	function handleAdd() {
		formError = '';
		if (inputAge === null || inputAge <= 0) {
			formError = 'Ålder måste vara ett positivt tal.';
			return;
		}

		if (inputWeight === null && inputLength === null && inputHC === null) {
			formError = 'Ange minst ett mätvärde.';
			return;
		}

		if (inputWeight !== null && inputWeight <= 0) {
			formError = 'Vikt måste vara ett positivt tal.';
			return;
		}
		if (inputLength !== null && inputLength <= 0) {
			formError = 'Längd måste vara ett positivt tal.';
			return;
		}
		if (inputHC !== null && inputHC <= 0) {
			formError = 'Huvudomfång måste vara ett positivt tal.';
			return;
		}

		// Add point to local state
		appState.addMeasurement({
			age: inputAge,
			ageUnit: appState.ageUnit,
			weight: inputWeight,
			length: inputLength,
			hc: inputHC
		});

		// Reset inputs
		inputWeight = null;
		inputLength = null;
		inputHC = null;

		// Auto-increment age by 1 for user convenience
		inputAge = inputAge + 1;
	}

	// Populate form with existing point to edit/override, or just delete and re-enter
	function handleDelete(id: string) {
		if (hoveredPoint) {
			hoveredPoint = null;
		}
		appState.deleteMeasurement(id);
	}

	// Dynamic CSS classes depending on the child's gender (clinical flat colors)
	let genderTheme = $derived.by(() => {
		if (appState.gender === 'boy') {
			return {
				textAccent: 'text-blue-600',
				bgAccent: 'bg-blue-600 hover:bg-blue-700',
				borderAccent: 'border-blue-200',
				badge: 'bg-blue-50 text-blue-750 border border-blue-200',
				mainCurve: 'stroke-blue-600',
				colorHex: '#2563eb'
			};
		} else {
			return {
				textAccent: 'text-pink-600',
				bgAccent: 'bg-pink-600 hover:bg-pink-700',
				borderAccent: 'border-pink-200',
				badge: 'bg-pink-50 text-pink-750 border border-pink-200',
				mainCurve: 'stroke-pink-600',
				colorHex: '#db2777'
			};
		}
	});

	// Grid tick generation for SVG axes
	let xTicks = $derived.by(() => {
		const ticks: number[] = [];
		let step = 1;
		if (activeTab === 'wfl') {
			step = 5;
		} else if (appState.ageUnit === 'weeks') {
			step = 1;
		} else {
			step = selectedRange === '1yr' ? 1 : selectedRange === '2yr' ? 2 : 5;
		}

		for (let x = xRange.min; x <= xRange.max; x += step) {
			ticks.push(x);
		}
		if (ticks[ticks.length - 1] !== xRange.max) {
			ticks.push(xRange.max);
		}
		return ticks;
	});

	let yTicks = $derived.by(() => {
		const ticks: number[] = [];
		const span = yRange.max - yRange.min;
		let step = 1;
		if (span > 50) step = 10;
		else if (span > 25) step = 5;
		else if (span > 10) step = 2;
		else step = 1;

		const start = Math.ceil(yRange.min);
		const end = Math.floor(yRange.max);
		for (let y = start; y <= end; y++) {
			if (y % step === 0) {
				ticks.push(y);
			}
		}
		return ticks;
	});
</script>

<div
	class="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-500/20 selection:text-slate-900"
>
	<div class="max-w-7xl mx-auto px-4 py-8 md:px-8">
		<!-- HEADER -->
		<header
			class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 border-b border-slate-200 pb-6"
		>
			<div>
				<h1 class="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">Tillväxtkurva</h1>
			</div>

			<!-- Settings: Gender and Age Unit Toggle -->
			<div class="flex flex-wrap items-center gap-3">
				<!-- Gender Select -->
				<div class="flex bg-slate-100 border border-slate-200 rounded-lg p-1 gap-1 items-center">
					<button
						onclick={() => appState.setGender('boy')}
						class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {appState.gender ===
						'boy'
							? 'bg-blue-600 text-white shadow-sm'
							: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
					>
						Pojke
					</button>
					<button
						onclick={() => appState.setGender('girl')}
						class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {appState.gender ===
						'girl'
							? 'bg-pink-600 text-white shadow-sm'
							: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
					>
						Flicka
					</button>
				</div>

				<!-- Age Unit Select -->
				<div class="flex bg-slate-100 border border-slate-200 rounded-lg p-1 gap-1 items-center">
					<button
						onclick={() => {
							appState.setAgeUnit('weeks');
							if (inputAge !== null) inputAge = Math.round(inputAge * 4.3482);
						}}
						class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {appState.ageUnit ===
						'weeks'
							? 'bg-white text-slate-850 border border-slate-200 shadow-sm'
							: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
						disabled={activeTab === 'wfl'}
						class:opacity-50={activeTab === 'wfl'}
						title={activeTab === 'wfl' ? 'Vikt-för-längd använder inte åldersenhet' : ''}
					>
						Veckor
					</button>
					<button
						onclick={() => {
							appState.setAgeUnit('months');
							if (inputAge !== null) inputAge = Math.round(inputAge / 4.3482);
						}}
						class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {appState.ageUnit ===
						'months'
							? 'bg-white text-slate-850 border border-slate-200 shadow-sm'
							: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
						disabled={activeTab === 'wfl'}
						class:opacity-50={activeTab === 'wfl'}
						title={activeTab === 'wfl' ? 'Vikt-för-längd använder inte åldersenhet' : ''}
					>
						Månader
					</button>
				</div>
			</div>
		</header>

		<!-- CONTENT GRID -->
		<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
			<!-- LEFT COLUMN: Forms, Logs, Data Settings (5 cols) -->
			<div class="lg:col-span-5 flex flex-col gap-8">
				<!-- INPUT FORM CARD -->
				<div class="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
					<h2 class="text-lg font-bold text-slate-900 mb-4">Logga mätning</h2>

					<form
						onsubmit={(e) => {
							e.preventDefault();
							handleAdd();
						}}
						class="space-y-4"
					>
						<div class="grid grid-cols-2 gap-4">
							<!-- Age field (Weeks or Months) -->
							<div>
								<label
									for="age-input"
									class="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
								>
									{appState.ageUnit === 'weeks' ? 'Ålder (veckor)' : 'Ålder (månader)'}
									<span class="text-red-500">*</span>
								</label>
								<div class="relative">
									<input
										id="age-input"
										type="number"
										step="any"
										bind:value={inputAge}
										placeholder={appState.ageUnit === 'weeks' ? 't.ex. 6' : 't.ex. 3'}
										class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-all text-sm"
										required
									/>
								</div>
							</div>

							<!-- Weight field -->
							<div>
								<label
									for="weight-input"
									class="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
								>
									Vikt (kg)
								</label>
								<input
									id="weight-input"
									type="number"
									step="any"
									bind:value={inputWeight}
									placeholder="t.ex. 5.6"
									class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-all text-sm"
								/>
							</div>
						</div>

						<div class="grid grid-cols-2 gap-4">
							<!-- Length/Height field -->
							<div>
								<label
									for="length-input"
									class="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
								>
									Längd (cm)
								</label>
								<input
									id="length-input"
									type="number"
									step="any"
									bind:value={inputLength}
									placeholder="t.ex. 58"
									class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-all text-sm"
								/>
							</div>

							<!-- Head Circumference (HC) field -->
							<div>
								<label
									for="hc-input"
									class="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
								>
									Huvudomfång (cm)
								</label>
								<input
									id="hc-input"
									type="number"
									step="any"
									bind:value={inputHC}
									placeholder="t.ex. 39.5"
									class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-all text-sm"
								/>
							</div>
						</div>

						{#if formError}
							<p
								class="text-red-600 text-xs font-semibold bg-red-50 border border-red-200 px-3 py-2 rounded-md"
							>
								{formError}
							</p>
						{/if}

						<button
							type="submit"
							class="w-full text-white font-semibold py-2 px-4 rounded-md cursor-pointer transition-all duration-200 text-sm shadow-sm {genderTheme.bgAccent}"
						>
							Lägg till mätpunkt
						</button>
					</form>
				</div>

				<!-- MEASUREMENTS LIST / TABLE -->
				<div
					class="bg-white border border-slate-200 rounded-lg p-6 shadow-sm flex flex-col max-h-[450px]"
				>
					<div class="flex justify-between items-center mb-4">
						<h2 class="text-lg font-bold text-slate-900">Registrerade punkter</h2>
						{#if appState.measurements.length > 0}
							<button
								onclick={() => {
									if (confirm('Vill du verkligen rensa all historik?')) appState.clearAll();
								}}
								class="text-xs text-slate-500 hover:text-red-650 font-medium px-2 py-1 rounded hover:bg-red-50 border border-transparent hover:border-red-200 transition-all cursor-pointer"
							>
								Rensa allt
							</button>
						{/if}
					</div>

					{#if appState.measurements.length === 0}
						<div
							class="text-center py-12 border border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center"
						>
							<p class="text-slate-400 text-sm px-4">Inga mätningar registrerade.</p>
						</div>
					{:else}
						<div class="overflow-y-auto pr-1 flex-1">
							<table class="w-full text-left border-collapse">
								<thead>
									<tr
										class="border-b border-slate-200 text-slate-450 text-[10px] font-semibold uppercase tracking-wider"
									>
										<th class="pb-2 font-semibold">Ålder</th>
										<th class="pb-2 font-semibold">Vikt</th>
										<th class="pb-2 font-semibold">Längd</th>
										<th class="pb-2 font-semibold">Huvudomfång</th>
										<th class="pb-2 font-semibold text-right"></th>
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-100 text-sm text-slate-700">
									{#each appState.measurements as m (m.id)}
										<tr class="hover:bg-slate-50 transition-colors group">
											<td class="py-2.5 font-semibold text-slate-900">
												{m.age}
												{m.ageUnit === 'weeks' ? 'v' : 'm'}
											</td>
											<td class="py-2.5">
												{m.weight !== null ? `${m.weight.toFixed(1)} kg` : '—'}
											</td>
											<td class="py-2.5">
												{m.length !== null ? `${m.length.toFixed(1)} cm` : '—'}
											</td>
											<td class="py-2.5">
												{m.hc !== null ? `${m.hc.toFixed(1)} cm` : '—'}
											</td>
											<td class="py-2.5 text-right">
												<button
													onclick={() => handleDelete(m.id)}
													class="p-1 text-slate-400 hover:text-red-650 hover:bg-red-50 rounded transition-all cursor-pointer opacity-80 group-hover:opacity-100"
													title="Ta bort mätning"
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														class="h-4 w-4"
														fill="none"
														viewBox="0 0 24 24"
														stroke="currentColor"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
														/>
													</svg>
												</button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			</div>

			<!-- RIGHT COLUMN: Chart, Tab Controls (7 cols) -->
			<div class="lg:col-span-7 flex flex-col gap-8">
				<!-- CHART CONTAINER CARD -->
				<div class="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
					<!-- Chart Metric Tabs & Range selection -->
					<div
						class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6"
					>
						<!-- Metric Select -->
						<div
							class="flex bg-slate-100 border border-slate-200 rounded-lg p-1 gap-1 items-center"
						>
							<button
								onclick={() => (activeTab = 'wfa')}
								class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {activeTab ===
								'wfa'
									? 'bg-white text-slate-900 border border-slate-200 shadow-sm'
									: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
							>
								Vikt
							</button>
							<button
								onclick={() => (activeTab = 'lhfa')}
								class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {activeTab ===
								'lhfa'
									? 'bg-white text-slate-900 border border-slate-200 shadow-sm'
									: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
							>
								Längd
							</button>
							<button
								onclick={() => (activeTab = 'hcfa')}
								class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {activeTab ===
								'hcfa'
									? 'bg-white text-slate-900 border border-slate-200 shadow-sm'
									: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
							>
								Huvudomfång
							</button>
							<button
								onclick={() => (activeTab = 'wfl')}
								class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {activeTab ===
								'wfl'
									? 'bg-white text-slate-900 border border-slate-200 shadow-sm'
									: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
							>
								Vikt-för-längd
							</button>
						</div>

						<!-- View Range Toggle for Months -->
						{#if appState.ageUnit === 'months' && activeTab !== 'wfl'}
							<div
								class="flex bg-slate-100 border border-slate-200 rounded-lg p-1 gap-1 items-center"
							>
								<button
									onclick={() => (selectedRange = '1yr')}
									class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {selectedRange ===
									'1yr'
										? 'bg-white text-slate-900 border border-slate-200 shadow-sm'
										: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
								>
									1 år
								</button>
								<button
									onclick={() => (selectedRange = '2yr')}
									class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {selectedRange ===
									'2yr'
										? 'bg-white text-slate-900 border border-slate-200 shadow-sm'
										: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
								>
									2 år
								</button>
								<button
									onclick={() => (selectedRange = '5yr')}
									class="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer {selectedRange ===
									'5yr'
										? 'bg-white text-slate-900 border border-slate-200 shadow-sm'
										: 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'}"
								>
									5 år
								</button>
							</div>
						{/if}
					</div>

					<!-- SVG Chart Area -->
					<div
						class="relative bg-white rounded-lg p-2 border border-slate-200 overflow-hidden select-none"
					>
						{#if filteredWHODataset.length === 0}
							<div class="w-full h-[400px] flex items-center justify-center text-slate-400">
								Laddar kurvdata...
							</div>
						{:else}
							<svg viewBox="0 0 {svgW} {svgH}" class="w-full h-auto">
								<!-- GRID LINES & AXIS TICKS -->
								<g class="grid-lines">
									<!-- Vertical grid lines -->
									{#each xTicks as tick}
										{@const xCoord = projectX(tick)}
										<line
											x1={xCoord}
											y1={padT}
											x2={xCoord}
											y2={svgH - padB}
											class="stroke-slate-200"
											stroke-width="1"
										/>
										<text
											x={xCoord}
											y={svgH - padB + 20}
											class="fill-slate-500 text-[10px] text-center font-medium"
											text-anchor="middle"
										>
											{tick}
										</text>
									{/each}

									<!-- Horizontal grid lines -->
									{#each yTicks as tick}
										{@const yCoord = projectY(tick)}
										<line
											x1={padL}
											y1={yCoord}
											x2={svgW - padR}
											y2={yCoord}
											class="stroke-slate-200"
											stroke-width="1"
										/>
										<text
											x={padL - 10}
											y={yCoord + 3}
											class="fill-slate-500 text-[10px]"
											text-anchor="end"
										>
											{tick}
										</text>
									{/each}
								</g>

								<!-- WHO STANDARD DEVIATION BANDS (SHADING) -->
								<path
									d={getShadedBandPath('sd2neg', 'sd2')}
									fill={appState.gender === 'boy'
										? 'rgba(59,130,246,0.015)'
										: 'rgba(219,39,119,0.015)'}
								/>
								<path
									d={getShadedBandPath('sd1neg', 'sd1')}
									fill={appState.gender === 'boy'
										? 'rgba(59,130,246,0.025)'
										: 'rgba(219,39,119,0.025)'}
								/>

								<!-- WHO PERCENTILE LINES -->
								<!-- +3 SD -->
								<path
									d={getCurvePath('sd3')}
									fill="none"
									class="stroke-red-500"
									stroke-width="1"
									stroke-dasharray="3,3"
								/>
								<!-- +2 SD -->
								<path
									d={getCurvePath('sd2')}
									fill="none"
									class="stroke-orange-500"
									stroke-width="1.2"
								/>
								<!-- +1 SD -->
								<path
									d={getCurvePath('sd1')}
									fill="none"
									class="stroke-emerald-500"
									stroke-width="1"
									stroke-dasharray="4,4"
								/>

								<!-- Median / SD0 (Solid green line) -->
								<path
									d={getCurvePath('sd0')}
									fill="none"
									class="stroke-emerald-600"
									stroke-width="2"
								/>

								<!-- -1 SD -->
								<path
									d={getCurvePath('sd1neg')}
									fill="none"
									class="stroke-emerald-500"
									stroke-width="1"
									stroke-dasharray="4,4"
								/>
								<!-- -2 SD -->
								<path
									d={getCurvePath('sd2neg')}
									fill="none"
									class="stroke-orange-500"
									stroke-width="1.2"
								/>
								<!-- -3 SD -->
								<path
									d={getCurvePath('sd3neg')}
									fill="none"
									class="stroke-red-500"
									stroke-width="1"
									stroke-dasharray="3,3"
								/>

								<!-- Line labels inside the plot on the right side -->
								{#if filteredWHODataset.length > 0}
									{@const last = filteredWHODataset[filteredWHODataset.length - 1]}
									<text
										x={svgW - padR + 6}
										y={projectY(last.sd3) + 3}
										class="fill-red-500 text-[8px] font-bold"
										text-anchor="start">+3 SD</text
									>
									<text
										x={svgW - padR + 6}
										y={projectY(last.sd2) + 3}
										class="fill-orange-500 text-[8px] font-bold"
										text-anchor="start">+2 SD</text
									>
									<text
										x={svgW - padR + 6}
										y={projectY(last.sd1) + 3}
										class="fill-emerald-500 text-[8px] font-bold"
										text-anchor="start">+1 SD</text
									>
									<text
										x={svgW - padR + 6}
										y={projectY(last.sd0) + 3}
										class="fill-emerald-600 text-[8px] font-bold"
										text-anchor="start">Median</text
									>
									<text
										x={svgW - padR + 6}
										y={projectY(last.sd1neg) + 3}
										class="fill-emerald-500 text-[8px] font-bold"
										text-anchor="start">-1 SD</text
									>
									<text
										x={svgW - padR + 6}
										y={projectY(last.sd2neg) + 3}
										class="fill-orange-500 text-[8px] font-bold"
										text-anchor="start">-2 SD</text
									>
									<text
										x={svgW - padR + 6}
										y={projectY(last.sd3neg) + 3}
										class="fill-red-500 text-[8px] font-bold"
										text-anchor="start">-3 SD</text
									>
								{/if}

								<!-- CHILD'S GROWTH CURVE -->
								{#if childPlotPoints.length > 0}
									{@const validPoints = childPlotPoints.filter((p) => p.inRange)}
									{#if validPoints.length > 0}
										<!-- Trend Line -->
										<path
											d={validPoints
												.map(
													(p, i) =>
														`${i === 0 ? 'M' : 'L'} ${projectX(p.x).toFixed(1)} ${projectY(p.y!).toFixed(1)}`
												)
												.join(' ')}
											fill="none"
											class={genderTheme.mainCurve}
											stroke-width="2.5"
										/>

										<!-- Points -->
										{#each validPoints as p}
											{@const cx = projectX(p.x)}
											{@const cy = projectY(p.y!)}
											{@const lms = getPointLMS(p.raw, activeTab)}

											<!-- Interactive point group -->
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<g
												class="cursor-pointer group"
												onmouseenter={() => {
													if (lms) {
														hoveredPoint = {
															age: p.x,
															ageUnit: appState.ageUnit,
															val: p.y!,
															metric: activeTab,
															z: lms.z,
															pct: lms.pct
														};
													}
												}}
												onmouseleave={() => {
													hoveredPoint = null;
												}}
											>
												<circle
													{cx}
													{cy}
													r="8"
													class="fill-transparent group-hover:fill-slate-900/5 transition-colors"
												/>
												<circle
													{cx}
													{cy}
													r="4.5"
													fill="#ffffff"
													class="stroke-slate-900"
													stroke-width="1.5"
												/>
												<circle {cx} {cy} r="2.5" fill={genderTheme.colorHex} />
											</g>
										{/each}
									{/if}
								{/if}

								<!-- AXIS LABELS -->
								<!-- Y-axis Title -->
								<text
									x={15}
									y={svgH / 2}
									class="fill-slate-500 text-xs font-semibold uppercase tracking-wider"
									transform="rotate(-90 15 {svgH / 2})"
									text-anchor="middle"
								>
									{getYLabel(activeTab)}
								</text>

								<!-- X-axis Title -->
								<text
									x={svgW / 2}
									y={svgH - 12}
									class="fill-slate-500 text-xs font-semibold uppercase tracking-wider"
									text-anchor="middle"
								>
									{getXLabel()}
								</text>
							</svg>
						{/if}

						<!-- Floating hover tooltip overlay inside chart -->
						{#if hoveredPoint}
							{@const xCoord = projectX(hoveredPoint.age)}
							{@const yCoord = projectY(hoveredPoint.val)}
							<div
								class="absolute z-20 bg-slate-900 text-xs text-white p-3 rounded shadow-md border border-slate-700 pointer-events-none"
								style="left: {Math.min(svgW - 150, Math.max(10, xCoord - 70))}px; top: {Math.max(
									10,
									yCoord - 100
								)}px; min-width: 145px;"
							>
								<div class="font-bold border-b border-slate-700 pb-1 flex justify-between">
									<span>Mätpunkt</span>
									<span>
										{hoveredPoint.age.toFixed(1)}
										{activeTab === 'wfl' ? 'cm' : appState.ageUnit === 'weeks' ? 'v' : 'm'}
									</span>
								</div>
								<div class="flex justify-between gap-4 mt-1">
									<span class="text-slate-350">Värde:</span>
									<span class="font-semibold"
										>{hoveredPoint.val.toFixed(1)}
										{activeTab === 'wfa' || activeTab === 'wfl' ? 'kg' : 'cm'}</span
									>
								</div>
								<div class="flex justify-between gap-4">
									<span class="text-slate-355">Z-score:</span>
									<span class="font-semibold">{formatZ(hoveredPoint.z)}</span>
								</div>
								<div class="flex justify-between gap-4">
									<span class="text-slate-355">Percentil:</span>
									<span class="font-semibold">{hoveredPoint.pct.toFixed(1)}%</span>
								</div>
							</div>
						{/if}
					</div>
					{#if activeTab === 'lhfa' && appState.ageUnit === 'months'}
						<p class="mt-3 text-[11px] text-slate-500 leading-relaxed">
							* Övergången vid 24 månader reflekterar WHO:s standard där liggande längd (recumbent
							length) mäts upp till 2 år, och stående längd (stature, vilket i genomsnitt är 0,7 cm
							kortare) mäts därefter.
						</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- FOOTER -->
		<footer class="mt-12 border-t border-slate-205 pt-6 text-center text-xs text-slate-400">
			Datakälla: <a
				href="https://www.who.int/tools/child-growth-standards/standards"
				target="_blank"
				rel="noopener noreferrer"
				class="underline hover:text-slate-600">WHO Child Growth Standards</a
			>
		</footer>
	</div>
</div>
