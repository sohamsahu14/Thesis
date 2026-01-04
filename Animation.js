// ========================================
// NDVI Crop Phase Animation for 2020 — Dhamtari Croplands
// ========================================

// 1. Load Dhamtari district boundary
var dhamtari = ee.FeatureCollection("FAO/GAUL/2015/level2")
  .filter(ee.Filter.and(
    ee.Filter.eq('ADM1_NAME', 'Chhattisgarh'),
    ee.Filter.eq('ADM2_NAME', 'Dhamtari')
  ));
var dhamtariGeometry = dhamtari.geometry();

// 2. Load ESA WorldCover cropland and scatter it
var worldcover = ee.ImageCollection("ESA/WorldCover/v200").first().clip(dhamtariGeometry);
var cropland10m = worldcover.eq(40).selfMask();
var randomMask = ee.Image.random().lt(0.2);
var scatteredCropland = cropland10m.updateMask(randomMask);
var connected = scatteredCropland.connectedComponents({
  connectedness: ee.Kernel.plus(1),
  maxSize: 100
});
var patchSize = connected.select('labels').connectedPixelCount({
  maxSize: 128,
  eightConnected: true
});
var smallPatches = patchSize.lt(150);
var filteredCropland = scatteredCropland.updateMask(smallPatches);

// 3. Reproject cropland mask to MODIS scale
var croplandMaskAtMODIS = filteredCropland.reproject('EPSG:4326', null, 250);

// 4. Load and process MODIS NDVI data for 2020
var modis = ee.ImageCollection('MODIS/006/MOD13Q1')
  .filterBounds(dhamtariGeometry)
  .filterDate('2020-01-01', '2020-12-31')
  .select(['NDVI', 'DetailedQA']);

var processModis = function(image) {
  var scaled = image.select('NDVI').multiply(0.0001);
  var qa = image.select('DetailedQA');
  var mask = qa.bitwiseAnd(1).eq(0);
  return scaled.updateMask(mask)
              .updateMask(croplandMaskAtMODIS)
              .reproject('EPSG:4326', null, 250)
              .copyProperties(image, ['system:time_start']);
};
var modisProcessed = modis.map(processModis);

// 5. NDVI Classification
var classifyNDVI = function(image) {
  var ndvi = image.select('NDVI');
  var classified = ndvi.expression(
    "(b('NDVI') < 0.2) ? 0 :" +
    "(b('NDVI') < 0.4) ? 1 :" +
    "(b('NDVI') < 0.6) ? 2 :" +
    "(b('NDVI') < 0.8) ? 3 : 4"
  ).rename('phase');
  return image.addBands(classified).set('system:time_start', image.get('system:time_start'));
};
var classifiedCollection = modisProcessed.map(classifyNDVI);

// 6. Visualisation Parameters
var phaseVis = {
  min: 0,
  max: 4,
  palette: ['#FFFFFF', '#FFD700', '#00FF00', '#32CD32', '#006400'], // background white
};

// 7. Add Time-lapse Animation to Map
var rgbCollection = classifiedCollection.map(function(image) {
  var vis = image.select('phase').visualize(phaseVis);
  var withBoundary = vis.paint(dhamtariGeometry, 1, 1); // overlay district boundary in white
  return withBoundary.set({
    'system:time_start': image.get('system:time_start')
  });
});

// 8. Convert to video and add to map
var videoArgs = {
  dimensions: 768,
  region: dhamtariGeometry,
  framesPerSecond: 1.5, // slower animation
  crs: 'EPSG:4326'
};

print(ui.Thumbnail(rgbCollection, videoArgs, 'NDVI Crop Phase Animation (2020)'));

// 9. Add Legend to Map
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 15px', backgroundColor: '#FFFFFF'}});
legend.add(ui.Label({
  value: 'NDVI Phase Classification',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 6px 0'}
}));

var legendItems = [
  {color: '#FFFFFF', label: 'No Data/Bare Soil'},
  {color: '#FFD700', label: 'Initial Growth (0.2–0.4)'},
  {color: '#00FF00', label: 'Transplanting (0.4–0.6)'},
  {color: '#32CD32', label: 'Heading (0.6–0.8)'},
  {color: '#006400', label: 'Maturity (>0.8)'}
];

legendItems.forEach(function(item) {
  var colorBox = ui.Label('', {
    backgroundColor: item.color,
    padding: '8px',
    margin: '0 8px 0 0'
  });
  var description = ui.Label({value: item.label, style: {margin: '0 0 4px 0'}});
  legend.add(ui.Panel([colorBox, description], ui.Panel.Layout.Flow('horizontal')));
});

Map.add(legend);

// 10. Map Layers
Map.setOptions('SATELLITE');
Map.centerObject(dhamtariGeometry, 10);
Map.addLayer(filteredCropland, {palette: ['#000000']}, 'Filtered Cropland (Black)');
Map.addLayer(dhamtariGeometry, {color: 'blue'}, 'District Boundary');
// 11. Export Animation to Google Drive
/*Export.video.toDrive({
  collection: rgbCollection,
  description: 'NDVI_Crop_Phase_Animation_2020',
  folder: 'EarthEngineExports',  // Optional: Change to your preferred folder in Drive
  fileNamePrefix: 'ndvi_crop_phase_dhamtari_2020',
  framesPerSecond: 1.5,
  dimensions: 768,
  region: dhamtariGeometry,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});*/
