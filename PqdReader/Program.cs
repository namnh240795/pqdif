using System.Text.Json;
using Gemstone.PQDIF.Logical;

string filePath = args.Length > 0 ? args[0] : @"../40-6084 PQDIFExport_Utility S 10kV-v1.pqd";

await using var parser = new LogicalParser(filePath);
await parser.OpenAsync();

var container = parser.ContainerRecord;

var result = new Dictionary<string, object>
{
    ["title"] = container.Title ?? "",
    ["subject"] = container.Subject ?? "",
    ["notes"] = container.Notes ?? "",
    ["creationTime"] = container.Creation.ToString("o"),
    ["version"] = $"{container.WriterMajorVersion}.{container.WriterMinorVersion}",
    ["fileName"] = container.FileName ?? "",
    ["compressionStyle"] = container.CompressionStyle.ToString(),
    ["compressionAlgorithm"] = container.CompressionAlgorithm.ToString(),
    ["compatibleVersion"] = $"{container.CompatibleMajorVersion}.{container.CompatibleMinorVersion}",
    ["channels"] = new List<object>()
};

var observations = new List<object>();

while (await parser.HasNextObservationRecordAsync())
{
    var obs = await parser.NextObservationRecordAsync();

    // Observation fields
    string triggerMethod = "None";
    try { triggerMethod = obs.TriggerMethod.ToString(); } catch { }

    string timeTriggered = "";
    try { timeTriggered = obs.TimeTriggered.ToString("o"); } catch { }

    string disturbanceCategoryId = DisturbanceCategory.None.ToString();
    string disturbanceCategoryName = "";
    try
    {
        disturbanceCategoryId = obs.DisturbanceCategoryID.ToString();
        disturbanceCategoryName = DisturbanceCategory.ToString(obs.DisturbanceCategoryID);
    }
    catch { }

    uint[] channelTriggerIndex = Array.Empty<uint>();
    try { channelTriggerIndex = obs.ChannelTriggerIndex; } catch { }

    // DataSource fields
    var ds = obs.DataSource;
    var dsData = new Dictionary<string, object>
    {
        ["name"] = Safe(() => ds.DataSourceName) ?? "",
        ["owner"] = Safe(() => ds.DataSourceOwner) ?? "",
        ["location"] = Safe(() => ds.DataSourceLocation) ?? "",
        ["typeID"] = Safe(() => ds.DataSourceTypeID.ToString()) ?? "",
        ["vendorID"] = Safe(() => ds.VendorID.ToString()) ?? "",
        ["equipmentID"] = Safe(() => ds.EquipmentID.ToString()) ?? "",
        ["longitude"] = Safe(() => ds.Longitude.ToString()) ?? "",
        ["latitude"] = Safe(() => ds.Latitude.ToString()) ?? "",
        ["effective"] = Safe(() => ds.Effective.ToString("o")) ?? "",
    };

    // MonitorSettings fields
    var settings = obs.Settings;
    var settingsData = new Dictionary<string, object>
    {
        ["effective"] = Safe(() => settings?.Effective.ToString("o")) ?? "",
        ["timeInstalled"] = Safe(() => settings?.TimeInstalled.ToString("o")) ?? "",
        ["useCalibration"] = Safe(() => settings?.UseCalibration) ?? false,
        ["useTransducer"] = Safe(() => settings?.UseTransducer) ?? false,
        ["nominalFrequency"] = Safe(() => settings?.NominalFrequency) ?? 60.0,
    };

    var obsData = new Dictionary<string, object>
    {
        ["name"] = obs.Name ?? "",
        ["startTime"] = obs.StartTime.ToString("o"),
        ["createTime"] = obs.CreateTime.ToString("o"),
        ["triggerMethod"] = triggerMethod,
        ["timeTriggered"] = timeTriggered,
        ["disturbanceCategoryID"] = disturbanceCategoryId,
        ["disturbanceCategoryName"] = disturbanceCategoryName,
        ["channelTriggerIndex"] = channelTriggerIndex,
        ["dataSource"] = dsData,
        ["monitorSettings"] = settingsData,
        ["channels"] = new List<object>()
    };

    foreach (var channel in obs.ChannelInstances)
    {
        var chanDef = channel.Definition;

        // ChannelDefinition fields
        var chanDefData = new Dictionary<string, object>
        {
            ["channelName"] = chanDef.ChannelName ?? "",
            ["phase"] = chanDef.Phase.ToString(),
            ["phaseID"] = (uint)chanDef.Phase,
            ["quantityTypeID"] = chanDef.QuantityTypeID.ToString(),
            ["quantityTypeName"] = QuantityType.ToString(chanDef.QuantityTypeID) ?? "",
            ["quantityMeasured"] = chanDef.QuantityMeasured.ToString(),
            ["quantityMeasuredID"] = (uint)chanDef.QuantityMeasured,
            ["quantityName"] = Safe(() => chanDef.QuantityName) ?? "",
        };

        // ChannelInstance fields
        var chanInstData = new Dictionary<string, object>
        {
            ["channelDefinitionIndex"] = channel.ChannelDefinitionIndex,
            ["channelGroupID"] = Safe(() => channel.ChannelGroupID.ToString()) ?? "0",
            ["triggerModuleName"] = Safe(() => channel.TriggerModuleName) ?? "",
            ["crossTriggerDeviceName"] = Safe(() => channel.CrossTriggerDeviceName) ?? "",
        };

        // ChannelSetting fields (from monitor settings)
        var chanSettingData = new Dictionary<string, object>();
        try
        {
            var setting = channel.Setting;
            if (setting != null)
            {
                chanSettingData["channelDefinitionIndex"] = setting.ChannelDefinitionIndex;
                chanSettingData["xdSystemSideRatio"] = setting.XDSystemSideRatio;
                chanSettingData["xdMonitorSideRatio"] = setting.XDMonitorSideRatio;
            }
        }
        catch { }

        var chanData = new Dictionary<string, object>
        {
            ["name"] = chanDef.ChannelName ?? "",
            ["phase"] = chanDef.Phase.ToString(),
            ["quantityType"] = chanDef.QuantityTypeID.ToString(),
            ["quantityTypeName"] = QuantityType.ToString(chanDef.QuantityTypeID) ?? "",
            ["quantityMeasured"] = chanDef.QuantityMeasured.ToString(),
            ["definition"] = chanDefData,
            ["instance"] = chanInstData,
            ["setting"] = chanSettingData,
            ["series"] = new List<object>()
        };

        foreach (var series in channel.SeriesInstances)
        {
            var serDef = series.Definition;

            var seriesData = new Dictionary<string, object>
            {
                ["valueType"] = serDef.ValueTypeID.ToString(),
                ["valueTypeName"] = Safe(() => serDef.ValueTypeName) ?? "",
                ["units"] = serDef.QuantityUnits.ToString(),
                ["unitsID"] = (uint)serDef.QuantityUnits,
                ["characteristic"] = serDef.QuantityCharacteristicID.ToString(),
                ["storageMethod"] = serDef.StorageMethodID.ToString(),
                ["storageMethodID"] = (uint)serDef.StorageMethodID,
                ["nominalQuantity"] = serDef.SeriesNominalQuantity,
                ["seriesShareChannelIndex"] = Safe(() => series.SeriesShareChannelIndex.ToString()) ?? "",
                ["seriesShareSeriesIndex"] = Safe(() => series.SeriesShareSeriesIndex.ToString()) ?? "",
            };

            try
            {
                var values = series.OriginalValues;
                seriesData["count"] = values.Count;
                seriesData["values"] = values.Select(v => Convert.ToDouble(v)).ToList();
            }
            catch
            {
                seriesData["count"] = 0;
                seriesData["values"] = new List<double>();
            }

            ((List<object>)chanData["series"]).Add(seriesData);
        }

        ((List<object>)obsData["channels"]).Add(chanData);
    }

    observations.Add(obsData);
}

result["observations"] = observations;

// Print summary
Console.WriteLine($"Title: {container.Title}");
Console.WriteLine($"Created: {container.Creation}");
Console.WriteLine($"Version: {container.WriterMajorVersion}.{container.WriterMinorVersion}");
Console.WriteLine($"Compression: {container.CompressionAlgorithm}");
Console.WriteLine($"Observations: {observations.Count}");

long totalValues = 0;
foreach (var obs in observations)
{
    var obsDict = (Dictionary<string, object>)obs;
    Console.WriteLine($"\n  Observation: {obsDict["name"]}");
    var channels = (List<object>)obsDict["channels"];
    foreach (var ch in channels)
    {
        var chDict = (Dictionary<string, object>)ch;
        Console.WriteLine($"    Channel: {chDict["name"]} ({chDict["phase"]}, {chDict["quantityMeasured"]})");
        var seriesList = (List<object>)chDict["series"];
        foreach (var s in seriesList)
        {
            var sDict = (Dictionary<string, object>)s;
            var count = (int)sDict["count"];
            totalValues += count;
            Console.WriteLine($"      Series: {sDict["valueType"]} {sDict["units"]} ({count} values)");
        }
    }
}

Console.WriteLine($"\nTotal values exported: {totalValues:N0}");

// Write JSON for HTML viewer
Console.WriteLine("Serializing JSON...");
var json = JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
var outputPath = Path.Combine(Directory.GetCurrentDirectory(), "pqdif_data.json");
File.WriteAllText(outputPath, json);
Console.WriteLine($"JSON written to: {outputPath}");
Console.WriteLine($"JSON file size: {new FileInfo(outputPath).Length / 1024.0 / 1024.0:F1} MB");

// Safe helper to avoid crashes on missing optional fields
static T? Safe<T>(Func<T> getter)
{
    try { return getter(); }
    catch { return default; }
}
