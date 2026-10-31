import Toybox.Lang;

class RowerDataModel {
    public var strokeRate as Float = 0.0;
    public var strokeCount as Number = 0;
    public var avgStrokeRate as Float = 0.0;
    public var totalDistance as Number = 0;
    public var instantPace as Number = 0;       // seconds per 500m
    public var avgPace as Number = 0;           // seconds per 500m
    public var instantPower as Number = 0;      // Watts
    public var avgPower as Number = 0;          // Watts
    public var resistanceLevel as Number = 0;
    public var totalEnergy as Number = 0;       // kcal
    public var energyPerHour as Number = 0;
    public var energyPerMinute as Number = 0;
    public var heartRate as Number = 0;         // bpm
    public var metabolicEq as Float = 0.0;      // METs
    public var elapsedTime as Number = 0;       // seconds
    public var remainingTime as Number = 0;     // seconds
    public var rawFlags as Number = 0;

    function toDictionary() as Dictionary<String, Object> {
        var dict = {
            "strokeRate" => strokeRate,
            "strokeCount" => strokeCount,
            "avgStrokeRate" => avgStrokeRate,
            "totalDistance" => totalDistance,
            "instantPace" => instantPace,
            "avgPace" => avgPace,
            "instantPower" => instantPower,
            "avgPower" => avgPower,
            "resistanceLevel" => resistanceLevel,
            "totalEnergy" => totalEnergy,
            "energyPerHour" => energyPerHour,
            "energyPerMinute" => energyPerMinute,
            "heartRate" => heartRate,
            "metabolicEq" => metabolicEq,
            "elapsedTime" => elapsedTime,
            "remainingTime" => remainingTime,
            "rawFlags" => rawFlags
        };
        return dict;
    }
}

